import "server-only";
import type { PaymentEvent } from "@/core/application/ports/billing-gateway";

import {
  amountsMatch,
  decidePayment,
  extendPeriod,
  paymentTransition,
  paymentIdentityLocked,
  shouldGrantAccess,
  shouldRevokeAccess,
  type PaymentStatus,
} from "@/core/domain/billing/payment-rules";
import { getBillingGateway } from "@/infrastructure/billing/gateway-factory";
import { billingPlan, isBillingPeriod } from "@/core/domain/billing/plans";
import { accessAfterRefund } from "@/core/domain/billing/refund-access";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError, HttpError, readBoundedJson } from "@/shared/server/http";
import {
  isSerializationConflict,
  withSerializationRetry,
} from "@/infrastructure/billing/transaction-retry";

/** Only accepts events authenticated by a provider adapter, never browser payloads. */
export async function applyVerifiedPaymentEvent(event: PaymentEvent, provider: string, actorId?: string): Promise<void> {
    await withSerializationRetry(() => prisma.$transaction(
      async (tx) => {
        if (actorId) {
          const actor = await tx.user.findUnique({ where: { id: actorId } });
          if (actor?.role !== "ADMIN" || !actor.emailVerified) throw new HttpError(403, "Admin access required.", "FORBIDDEN");
        }
        // Read and decide inside each Serializable attempt, not on a stale
        // snapshot from before the retry.
        const payment = await tx.payment.findUnique({ where: { orderId: event.orderId } });
        if (!payment) throw new HttpError(404, "Order pembayaran tidak ditemukan.", "ORDER_NOT_FOUND");
        if (payment.provider !== provider) {
          throw new HttpError(400, "Penyedia pembayaran tidak sesuai.", "PROVIDER_MISMATCH");
        }
        if (event.paidCurrency && event.paidCurrency.toUpperCase() !== payment.currency.toUpperCase()) {
          throw new HttpError(400, "Mata uang pembayaran tidak sesuai.", "CURRENCY_MISMATCH");
        }
        if (!amountsMatch(event.paidAmount, payment.amount)) {
          throw new HttpError(400, "Nominal pembayaran tidak sesuai.", "AMOUNT_MISMATCH");
        }
        if (paymentIdentityLocked(payment) && payment.providerTransactionId && event.providerTransactionId && payment.providerTransactionId !== event.providerTransactionId) {
          throw new HttpError(409, "Payment ID berbeda dari pembayaran yang sudah diverifikasi.", "PAYMENT_ID_MISMATCH");
        }
        if (actorId) await tx.auditLog.create({ data: { actorId, action: "admin.payment.reconcile", entityType: "Payment", entityId: payment.id, metadata: { orderId: payment.orderId, provider, providerStatus: event.providerStatus } } });

        const storedStatus = payment.status as PaymentStatus;
        const needsRefundReview = payment.rawStatus?.startsWith("REFUND_REQUIRES_REVIEW:") ?? false;
        const recordedStatus = needsRefundReview && event.outcome !== "refunded"
          ? payment.rawStatus : event.providerStatus;
        // A partial refund has no known access duration. Keep the paid ledger
        // intact for other refunds, and allow a later full refund to be applied.
        // If it arrives before settlement, a replay must not grant full access.
        const partialReview = event.outcome === "partially_refunded";
        const heldSettlement = event.outcome === "paid" && storedStatus !== "SETTLED" && needsRefundReview;
        if (storedStatus !== "REFUNDED" && (partialReview || heldSettlement)) {
          await tx.payment.updateMany({ where: { id: payment.id, status: storedStatus }, data: {
            rawStatus: partialReview ? `REFUND_REQUIRES_REVIEW:${event.providerStatus}` : payment.rawStatus,
            providerTransactionId: event.providerTransactionId,
          } });
          await tx.auditLog.create({ data: { actorId: payment.userId, action: "billing.payment.refund-review", entityType: "Payment", entityId: payment.id,
            metadata: { orderId: payment.orderId, provider, requiresReconciliation: true, providerStatus: event.providerStatus } } });
          return;
        }
        const { status, successful } = decidePayment(event.outcome);
        const nextStatus = paymentTransition(storedStatus, status);
        if (nextStatus === null) {
          // Waiting/underpaid callbacks still provide the actual payment ID.
          // Keep it for reconciliation without granting access or downgrading a terminal state.
          if (storedStatus === "PENDING") await tx.payment.updateMany({
            where: { id: payment.id, status: "PENDING" },
            data: { rawStatus: recordedStatus, providerTransactionId: event.providerTransactionId },
          });
          return;
        }

        // Only the worker that claims the previous state may grant or revoke.
        // A read followed by an unconditional write lets two callbacks for the
        // same order each observe the old status and act twice.
        const changed = await tx.payment.updateMany({
          where: { id: payment.id, status: storedStatus },
          data: {
            status: nextStatus,
            rawStatus: recordedStatus,
            providerTransactionId: event.providerTransactionId,
            paidAt: nextStatus === "SETTLED" ? (payment.paidAt ?? new Date()) : payment.paidAt,
          },
        });
        if (changed.count !== 1) {
          throw new HttpError(503, "Status pembayaran berubah. Coba kirim ulang notifikasi.", "PAYMENT_STATE_CHANGED");
        }

        if (shouldGrantAccess(storedStatus, successful)) {
          const now = new Date();
          const current = await tx.subscription.findUnique({ where: { userId: payment.userId } });
          // Days come from the plan recorded on the order, so a repricing of
          // the catalogue cannot shorten access somebody already paid for.
          const bought = isBillingPeriod(payment.planPeriod) ? payment.planPeriod : "monthly";
          const days = payment.grantedDays ?? billingPlan(bought).days;
          if (!Number.isInteger(days) || days <= 0) throw new HttpError(409, "Invalid purchased access duration.", "INVALID_GRANT_DURATION");
          // A paid invoice must not replace an independent indefinite admin grant.
          const independentGrant = current?.provider === "admin" && current.plan === "PREMIUM" && current.currentPeriodEnd === null;
          const periodEnd = extendPeriod(current?.currentPeriodEnd, now, days);
          const periodStart = new Date(periodEnd.getTime() - days * 86_400_000);
          await tx.payment.update({ where: { id: payment.id }, data: {
            grantedDays: days,
            accessStartsAt: independentGrant ? null : periodStart,
            accessEndsAt: independentGrant ? null : periodEnd,
          } });
          if (independentGrant) {
            await tx.auditLog.create({ data: { actorId: payment.userId, action: "billing.payment.settled", entityType: "Payment", entityId: payment.id, metadata: { orderId: payment.orderId, provider, independentAdminGrant: true, days } } });
            return;
          }
          await tx.user.update({ where: { id: payment.userId }, data: { plan: "PREMIUM" } });
          // Recorded from the gateway that verified this callback. Hardcoding a
          // provider here would file a crypto payment under the card processor.
          await tx.subscription.upsert({
            where: { userId: payment.userId },
            create: { userId: payment.userId, provider, plan: "PREMIUM", status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd },
            update: { provider, plan: "PREMIUM", status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
          });
          await tx.auditLog.create({ data: { actorId: payment.userId, action: "billing.payment.settled", entityType: "Payment", entityId: payment.id, metadata: { orderId: payment.orderId, provider, days, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() } } });
          return;
        }

        if (shouldRevokeAccess(status, storedStatus)) {
          const now = new Date();
          const current = await tx.subscription.findUnique({ where: { userId: payment.userId } });
          const independentGrant = current?.provider === "admin";
          const remaining = independentGrant ? [] : await tx.payment.findMany({
            where: { userId: payment.userId, id: { not: payment.id }, OR: [
              { status: "SETTLED" },
              { status: "REFUNDED", rawStatus: { startsWith: "REFUND_REQUIRES_REVIEW:" } },
            ] },
            select: { id: true, accessStartsAt: true, accessEndsAt: true },
          });
          const access = independentGrant ? null : accessAfterRefund(current?.currentPeriodEnd ?? null, payment, remaining, now);
          if (access?.requiresReview) await tx.payment.update({
            where: { id: payment.id }, data: { rawStatus: `REFUND_REQUIRES_REVIEW:${event.providerStatus}` },
          });
          if (access && !access.requiresReview) {
            for (const shifted of access.shifted) {
              await tx.payment.update({ where: { id: shifted.id }, data: { accessStartsAt: shifted.accessStartsAt, accessEndsAt: shifted.accessEndsAt } });
            }
            const active = access.periodEnd !== null && access.periodEnd > now;
            await tx.user.update({ where: { id: payment.userId }, data: { plan: active ? "PREMIUM" : "FREE" } });
            await tx.subscription.updateMany({ where: { userId: payment.userId }, data: {
              plan: active ? "PREMIUM" : "FREE", status: active ? "ACTIVE" : "CANCELED", currentPeriodEnd: access.periodEnd,
            } });
          }
          await tx.auditLog.create({ data: { actorId: payment.userId, action: "billing.payment.refunded", entityType: "Payment", entityId: payment.id, metadata: {
            orderId: payment.orderId, provider, independentAdminGrant: independentGrant,
            requiresReconciliation: access?.requiresReview ?? false,
            remainingPeriodEnd: access?.periodEnd?.toISOString() ?? null,
          } } });
        }
      },
      { isolationLevel: "Serializable" },
    ));

}

export async function handlePaymentNotification(request: Request, provider: string): Promise<Response> {
  try {
    const payload = (await readBoundedJson(request, 65_536)) as Record<string, unknown>;
    const gateway = getBillingGateway(provider);
    const event = gateway.parseAndVerifyNotification({ payload, headers: request.headers });
    await applyVerifiedPaymentEvent(event, gateway.id);
    return Response.json({ received: true });
  } catch (error) {
    // A conflict that outlived every retry means the row stayed contended, not
    // that the callback was applied. Answer retryable instead of acknowledging
    // success or surfacing a bare 500.
    if (isSerializationConflict(error)) {
      return apiError(
        new HttpError(503, "Terjadi konflik saat memproses pembayaran. Coba kirim ulang notifikasi.", "PAYMENT_CONFLICT"),
      );
    }
    return apiError(error);
  }
}

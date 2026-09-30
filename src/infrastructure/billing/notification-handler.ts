import "server-only";

import {
  amountsMatch,
  decidePayment,
  extendPeriod,
  paymentTransition,
  shouldGrantAccess,
  shouldRevokeAccess,
  type PaymentStatus,
} from "@/core/domain/billing/payment-rules";
import { getBillingGateway } from "@/infrastructure/billing/gateway-factory";
import { billingPlan, isBillingPeriod } from "@/core/domain/billing/plans";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError, HttpError, readBoundedJson } from "@/shared/server/http";
import {
  isSerializationConflict,
  withSerializationRetry,
} from "@/infrastructure/billing/transaction-retry";

/**
 * Handles one payment callback, whichever provider sent it.
 *
 * Shared by every webhook route because the decisions after verification —
 * match the order, check the amount, persist the status, grant or revoke
 * access exactly once — belong to the app, not to a provider. Each route
 * supplies only its own provider name, so the callback is verified by the
 * adapter that signed it.
 */
export async function handlePaymentNotification(
  request: Request,
  provider: string,
): Promise<Response> {
  try {
    const payload = (await readBoundedJson(request, 65_536)) as Record<string, unknown>;
    const gateway = getBillingGateway(provider);
    const event = gateway.parseAndVerifyNotification({ payload, headers: request.headers });

    await withSerializationRetry(() => prisma.$transaction(
      async (tx) => {
        // Read and decide inside each Serializable attempt, not on a stale
        // snapshot from before the retry.
        const payment = await tx.payment.findUnique({ where: { orderId: event.orderId } });
        if (!payment) throw new HttpError(404, "Order pembayaran tidak ditemukan.", "ORDER_NOT_FOUND");
        if (payment.provider !== gateway.id) {
          throw new HttpError(400, "Penyedia pembayaran tidak sesuai.", "PROVIDER_MISMATCH");
        }
        if (event.paidCurrency && event.paidCurrency.toUpperCase() !== payment.currency.toUpperCase()) {
          throw new HttpError(400, "Mata uang pembayaran tidak sesuai.", "CURRENCY_MISMATCH");
        }
        if (!amountsMatch(event.paidAmount, payment.amount)) {
          throw new HttpError(400, "Nominal pembayaran tidak sesuai.", "AMOUNT_MISMATCH");
        }

        const { status, successful } = decidePayment(event.outcome);
        const storedStatus = payment.status as PaymentStatus;
        const nextStatus = paymentTransition(storedStatus, status);
        if (nextStatus === null) return;

        // Only the worker that claims the previous state may grant or revoke.
        // A read followed by an unconditional write lets two callbacks for the
        // same order each observe the old status and act twice.
        const changed = await tx.payment.updateMany({
          where: { id: payment.id, status: storedStatus },
          data: {
            status: nextStatus,
            rawStatus: event.providerStatus,
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
          const periodEnd = extendPeriod(current?.currentPeriodEnd, now, billingPlan(bought).days);
          await tx.user.update({ where: { id: payment.userId }, data: { plan: "PREMIUM" } });
          // Recorded from the gateway that verified this callback. Hardcoding a
          // provider here would file a crypto payment under the card processor.
          await tx.subscription.upsert({
            where: { userId: payment.userId },
            create: { userId: payment.userId, provider: gateway.id, plan: "PREMIUM", status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd },
            update: { provider: gateway.id, plan: "PREMIUM", status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
          });
          await tx.auditLog.create({ data: { actorId: payment.userId, action: "billing.payment.settled", entityType: "Payment", entityId: payment.id, metadata: { orderId: payment.orderId, provider: gateway.id, periodEnd: periodEnd.toISOString() } } });
          return;
        }

        if (shouldRevokeAccess(status, storedStatus)) {
          await tx.user.update({ where: { id: payment.userId }, data: { plan: "FREE" } });
          // Matched on the user alone. Filtering by provider would leave a
          // subscription standing whenever the refund arrives after the operator
          // has moved the deployment to a different processor.
          await tx.subscription.updateMany({ where: { userId: payment.userId }, data: { plan: "FREE", status: "CANCELED", currentPeriodEnd: new Date() } });
          await tx.auditLog.create({ data: { actorId: payment.userId, action: "billing.payment.refunded", entityType: "Payment", entityId: payment.id, metadata: { orderId: payment.orderId, provider: gateway.id } } });
        }
      },
      { isolationLevel: "Serializable" },
    ));

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

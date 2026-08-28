import "server-only";

import {
  amountsMatch,
  decidePayment,
  extendPeriod,
  shouldGrantAccess,
  shouldRevokeAccess,
  type PaymentStatus,
} from "@/core/domain/billing/payment-rules";
import { getBillingGateway } from "@/infrastructure/billing/gateway-factory";
import { billingPlan, isBillingPeriod } from "@/core/domain/billing/plans";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError, HttpError } from "@/shared/server/http";

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
    const payload: unknown = await request.json();
    const gateway = getBillingGateway(provider);
    const event = gateway.parseAndVerifyNotification({ payload, headers: request.headers });

    const payment = await prisma.payment.findUnique({ where: { orderId: event.orderId } });
    if (!payment) throw new HttpError(404, "Order pembayaran tidak ditemukan.", "ORDER_NOT_FOUND");
    if (!amountsMatch(event.paidAmount, payment.amount)) {
      throw new HttpError(400, "Nominal pembayaran tidak sesuai.", "AMOUNT_MISMATCH");
    }

    const { status, successful } = decidePayment(event.outcome);
    const storedStatus = payment.status as PaymentStatus;

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status,
          rawStatus: event.providerStatus,
          providerTransactionId: event.providerTransactionId,
          paidAt: successful ? (payment.paidAt ?? new Date()) : payment.paidAt,
        },
      });

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
      } else if (shouldRevokeAccess(status, storedStatus)) {
        await tx.user.update({ where: { id: payment.userId }, data: { plan: "FREE" } });
        // Matched on the user alone. Filtering by provider would leave a
        // subscription standing whenever the refund arrives after the operator
        // has moved the deployment to a different processor.
        await tx.subscription.updateMany({ where: { userId: payment.userId }, data: { plan: "FREE", status: "CANCELED", currentPeriodEnd: new Date() } });
        await tx.auditLog.create({ data: { actorId: payment.userId, action: "billing.payment.refunded", entityType: "Payment", entityId: payment.id, metadata: { orderId: payment.orderId, provider: gateway.id } } });
      }
    });

    return Response.json({ received: true });
  } catch (error) {
    return apiError(error);
  }
}

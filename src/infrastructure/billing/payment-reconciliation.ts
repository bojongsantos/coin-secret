import "server-only";
import { prisma } from "@/infrastructure/database/prisma";
import { getBillingGateway } from "@/infrastructure/billing/gateway-factory";
import { applyVerifiedPaymentEvent } from "@/infrastructure/billing/notification-handler";
import { HttpError } from "@/shared/server/http";
import { paymentIdentityLocked } from "@/core/domain/billing/payment-rules";

export async function reconcilePayment(actorId: string, id: string, suppliedPaymentId?: string) {
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) throw new HttpError(404, "Payment not found.", "NOT_FOUND");
  const gateway = getBillingGateway(payment.provider);
  if (!gateway.readPaymentStatus) throw new HttpError(409, "This provider does not support authenticated status lookup here.", "RECONCILIATION_UNSUPPORTED");
  // checkoutToken is an invoice ID, not the provider's actual payment ID.
  const paymentId = suppliedPaymentId ?? payment.providerTransactionId;
  if (!paymentId) throw new HttpError(409, "Enter the actual payment ID from the provider account, not the invoice ID.", "PAYMENT_ID_REQUIRED");
  if (paymentIdentityLocked(payment) && payment.providerTransactionId && paymentId !== payment.providerTransactionId) throw new HttpError(409, "Payment ID differs from the verified payment.", "PAYMENT_ID_MISMATCH");
  const event = await gateway.readPaymentStatus(paymentId);
  if (gateway.id !== payment.provider || event.orderId !== payment.orderId || event.providerTransactionId !== paymentId) {
    throw new HttpError(409, "Provider payment does not match this order.", "PAYMENT_ORDER_MISMATCH");
  }
  if (!event.paidCurrency) throw new HttpError(502, "Provider did not confirm the order currency.", "INVALID_PAYMENT_STATUS");
  // Rechecks the admin role, amount, currency and current payment state inside
  // the same Serializable transaction used by signed callbacks.
  await applyVerifiedPaymentEvent(event, gateway.id, actorId);
  const updated = await prisma.payment.findUnique({ where: { id }, select: { status: true, rawStatus: true } });
  return { status: updated?.status, providerStatus: event.providerStatus, requiresReview: updated?.rawStatus?.startsWith("REFUND_REQUIRES_REVIEW:") ?? false };
}

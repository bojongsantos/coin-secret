import { createHash } from "node:crypto";
import { z } from "zod";
import type { PaymentEvent, PaymentOutcomeKind } from "@/core/application/ports/billing-gateway";
import { hexDigestMatches } from "@/infrastructure/billing/signature";

/**
 * Midtrans wire format and rules, kept free of network calls and secrets
 * beyond what is passed in, so the protocol can be exercised directly by
 * tests. The gateway that talks to Midtrans wraps this.
 */

export const notificationSchema = z
  .object({
    order_id: z.string().min(1).max(50),
    transaction_id: z.string().optional(),
    gross_amount: z.string().regex(/^\d+(\.\d{2})?$/),
    currency: z.string().length(3).optional(),
    status_code: z.string(),
    transaction_status: z.string(),
    fraud_status: z.string().optional(),
    signature_key: z.string().length(128),
  })
  .passthrough();

export type MidtransNotification = z.infer<typeof notificationSchema>;

/** Signature over the fields Midtrans echoes back, as hex. */
export function midtransSignature(input: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  serverKey: string;
}): string {
  return createHash("sha512")
    .update(`${input.orderId}${input.statusCode}${input.grossAmount}${input.serverKey}`)
    .digest("hex");
}

/** Constant-time comparison, shared with every other provider adapter. */
export const signatureMatches = hexDigestMatches;

/**
 * Translates a Midtrans notification into the app's neutral outcome.
 *
 * A settlement counts as paid only when three things agree: the transaction
 * settled, the gateway reported success, and fraud screening accepted it. A
 * settlement failing any of them stays pending — a payment under review can
 * still be reversed, and treating it as paid would hand out a plan nobody
 * paid for. Unknown statuses stay pending rather than being guessed at.
 */
export function outcomeFor(notification: {
  transaction_status: string;
  status_code: string;
  fraud_status?: string;
}): PaymentOutcomeKind {
  const settled =
    notification.transaction_status === "settlement" ||
    notification.transaction_status === "capture";

  if (settled) {
    const fraudAccepted =
      notification.fraud_status === undefined ||
      notification.fraud_status.toLowerCase() === "accept";
    return notification.status_code === "200" && fraudAccepted ? "paid" : "pending";
  }

  switch (notification.transaction_status) {
    case "expire":
      return "expired";
    case "cancel":
      return "canceled";
    case "refund":
    case "partial_refund":
      return "refunded";
    case "deny":
    case "failure":
      return "failed";
    default:
      return "pending";
  }
}

/** Maps a verified notification onto the neutral event shape. */
export function toPaymentEvent(notification: MidtransNotification): PaymentEvent {
  return {
    orderId: notification.order_id,
    providerTransactionId: notification.transaction_id,
    paidAmount: notification.gross_amount,
    paidCurrency: notification.currency,
    outcome: outcomeFor(notification),
    providerStatus: notification.transaction_status,
    raw: notification,
  };
}

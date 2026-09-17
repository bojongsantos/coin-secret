import { createHmac } from "node:crypto";
import { z } from "zod";
import type { PaymentEvent, PaymentOutcomeKind } from "@/core/application/ports/billing-gateway";
import { hexDigestMatches } from "@/infrastructure/billing/signature";

/**
 * NOWPayments wire format and rules, kept free of network calls and of secrets
 * beyond what is passed in, so the protocol can be exercised directly by
 * tests. The gateway that talks to NOWPayments wraps this.
 */

/** Header NOWPayments puts the IPN signature in. */
export const SIGNATURE_HEADER = "x-nowpayments-sig";

export const ipnSchema = z
  .object({
    order_id: z.string().min(1),
    payment_id: z.union([z.string(), z.number()]).optional(),
    payment_status: z.string().min(1),
    price_amount: z.union([z.string(), z.number()]),
    price_currency: z.string().optional(),
    pay_amount: z.union([z.string(), z.number()]).optional(),
    actually_paid: z.union([z.string(), z.number()]).optional(),
    pay_currency: z.string().optional(),
  })
  .passthrough();

export type NowPaymentsIpn = z.infer<typeof ipnSchema>;

/**
 * Serialises a payload the way NOWPayments signs it: keys sorted, then
 * `JSON.stringify` with that key list.
 *
 * Passing an array as the second argument makes `JSON.stringify` use it as a
 * key filter at *every* level, not just the top one. That is a quirk rather
 * than a design, but it is what NOWPayments' own example does, so reproducing
 * it exactly is the only way a signature verifies. Deviating "correctly" here
 * would reject every genuine callback.
 */
export function canonicalPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/** HMAC-SHA512 of the canonical payload, as hex. */
export function ipnSignature(payload: Record<string, unknown>, ipnSecret: string): string {
  return createHmac("sha512", ipnSecret).update(canonicalPayload(payload)).digest("hex");
}

/** Constant-time comparison, shared with every other provider adapter. */
export const signatureMatches = hexDigestMatches;

/**
 * Translates a NOWPayments status into the app's neutral outcome.
 *
 * `partially_paid` becomes `underpaid` rather than paid or failed. Crypto
 * buyers routinely send slightly less than quoted — a wallet fee deducted from
 * the amount, or a price that moved between quote and broadcast — and the
 * money is genuinely in the account. It is neither a completed order nor a
 * failed one, and it needs a human decision.
 *
 * `confirmed` is *not* paid. NOWPayments marks a payment confirmed once it has
 * enough on-chain confirmations but before the funds are converted and settled
 * to the merchant; `finished` is the only status that means the order is done.
 * Unknown statuses stay pending rather than being guessed at.
 */
export function outcomeFor(status: string): PaymentOutcomeKind {
  switch (status.toLowerCase()) {
    case "finished":
      return "paid";
    case "partially_paid":
      return "underpaid";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    case "expired":
      return "expired";
    case "waiting":
    case "confirming":
    case "confirmed":
    case "sending":
      return "pending";
    default:
      return "pending";
  }
}

/**
 * Maps a verified callback onto the neutral event shape.
 *
 * `price_amount` is reported as the paid amount, never `actually_paid`. The
 * order is denominated in the store's currency while `actually_paid` is a
 * quantity of crypto, so comparing the latter against the order total would
 * reject every genuine payment. Whether the buyer sent too little is carried
 * by the status instead, as `underpaid`.
 */
export function toPaymentEvent(ipn: NowPaymentsIpn): PaymentEvent {
  return {
    orderId: ipn.order_id,
    providerTransactionId: ipn.payment_id === undefined ? undefined : String(ipn.payment_id),
    paidAmount: String(ipn.price_amount),
    paidCurrency: ipn.price_currency,
    outcome: outcomeFor(ipn.payment_status),
    providerStatus: ipn.payment_status,
    raw: ipn,
  };
}

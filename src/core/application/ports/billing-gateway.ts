/**
 * What a payment callback means, expressed in terms the app acts on rather
 * than in any one provider's vocabulary.
 *
 * Each adapter is responsible for translating its provider's status strings
 * into exactly one of these. Anything an adapter does not recognise must
 * become `pending`, never a guess that grants or revokes access.
 */
export type PaymentOutcomeKind =
  | "paid"
  | "pending"
  | "underpaid"
  | "failed"
  | "expired"
  | "canceled"
  | "refunded";

export interface CheckoutRequest {
  orderId: string;
  /** Amount to charge, in the smallest unit the currency is quoted in. */
  amount: number;
  /** ISO currency code the amount is quoted in, for example "IDR". */
  currency: string;
  /** Product wording shown on the provider-hosted checkout. */
  description: string;
  customer: { name: string; email: string };
}

export interface CheckoutResult {
  /** Where to send the buyer to complete payment. */
  redirectUrl: string;
  /**
   * The provider's own handle for this checkout, stored so a payment can be
   * reconciled later. Midtrans calls it a Snap token; other providers call it
   * an invoice or payment id.
   */
  reference: string;
}

/**
 * A verified callback, normalised.
 *
 * Adapters return this only after confirming the message genuinely came from
 * the provider. An unverified message must raise instead of being returned.
 */
export interface PaymentEvent {
  orderId: string;
  providerTransactionId?: string;
  /** Amount the provider reports as received, in the order's currency. */
  paidAmount: string;
  /** Currency the provider reports, when its callback supplies one. */
  paidCurrency?: string;
  outcome: PaymentOutcomeKind;
  /** The provider's raw status string, kept for audit and debugging. */
  providerStatus: string;
  raw: Record<string, unknown>;
}

/**
 * A callback as it arrived.
 *
 * Headers travel with the payload because providers disagree on where the
 * signature lives: Midtrans puts it in the body, others use a header.
 */
export interface NotificationInput {
  payload: unknown;
  headers: Headers;
}

export interface BillingGateway {
  /** Stored on the payment row so each charge records who processed it. */
  readonly id: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  /** Verifies authenticity, then normalises. Throws when verification fails. */
  parseAndVerifyNotification(input: NotificationInput): PaymentEvent;
}

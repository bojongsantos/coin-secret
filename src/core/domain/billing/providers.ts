/**
 * Payment providers this app can charge with.
 *
 * Declared in the domain rather than beside the adapters so the pricing copy,
 * the readiness report, and the tests can all be checked against one list.
 * The adapters themselves cannot be imported outside a server context, which
 * would otherwise leave each of those places keeping its own private copy.
 */
export const PAYMENT_PROVIDERS = ["midtrans", "nowpayments", "nowpayments-sandbox"] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const DEFAULT_PAYMENT_PROVIDER: PaymentProvider = "midtrans";

export function isPaymentProvider(value: string): value is PaymentProvider {
  return (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

import type { PaymentOutcomeKind } from "@/core/application/ports/billing-gateway";

export type PaymentStatus =
  | "PENDING"
  | "SETTLED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELED"
  | "REFUNDED";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The status to persist for a normalised outcome.
 *
 * `underpaid` is deliberately stored as PENDING: money arrived but not the
 * agreed amount, so the order is neither complete nor failed. It needs a
 * decision — refund, top-up, or manual release — and must not silently pass
 * as paid. No adapter produces it yet; the crypto providers will.
 */
export function statusForOutcome(outcome: PaymentOutcomeKind): PaymentStatus {
  switch (outcome) {
    case "paid":
      return "SETTLED";
    case "failed":
      return "FAILED";
    case "expired":
      return "EXPIRED";
    case "canceled":
      return "CANCELED";
    case "refunded":
      return "REFUNDED";
    case "underpaid":
    case "pending":
      return "PENDING";
  }
}

/** Only a fully paid order opens access. */
export function grantsAccess(outcome: PaymentOutcomeKind): boolean {
  return outcome === "paid";
}

export interface PaymentDecision {
  /** Status to persist for the payment row. */
  status: PaymentStatus;
  /** True only when access should actually be granted. */
  successful: boolean;
}

/** Turns a normalised outcome into what to store and whether to grant access. */
export function decidePayment(outcome: PaymentOutcomeKind): PaymentDecision {
  return { status: statusForOutcome(outcome), successful: grantsAccess(outcome) };
}

/**
 * Whether the amount the provider reports matches what was charged.
 *
 * Compared numerically because providers send a decimal string such as
 * "99000.00" while the order stores an integer.
 */
export function amountsMatch(paidAmount: string, expectedAmount: number): boolean {
  const received = Number(paidAmount);
  if (!Number.isFinite(received) || !Number.isFinite(expectedAmount)) return false;
  return received === expectedAmount;
}

/**
 * End of the access period after a successful payment.
 *
 * Paying again while a period is still running extends it from the existing
 * end date, so a customer never loses days by renewing early. An expired or
 * missing period starts fresh from now.
 */
export function extendPeriod(
  currentEnd: Date | null | undefined,
  now: Date,
  /** Days the settled payment bought. */
  days: number,
): Date {
  const stillRunning = currentEnd !== null && currentEnd !== undefined && currentEnd > now;
  const base = stillRunning ? currentEnd : now;
  return new Date(base.getTime() + days * DAY_MS);
}

/**
 * Whether this settlement should still be acted upon.
 *
 * Providers retry callbacks, so the same settlement arrives more than once.
 * Access is granted on the first one only; repeats must not stack extra days
 * onto the subscription.
 */
export function shouldGrantAccess(storedStatus: PaymentStatus, successful: boolean): boolean {
  return successful && storedStatus !== "SETTLED";
}

/** Whether a refund should pull access back. Only a paid period can be revoked. */
export function shouldRevokeAccess(
  incomingStatus: PaymentStatus,
  storedStatus: PaymentStatus,
): boolean {
  return incomingStatus === "REFUNDED" && storedStatus === "SETTLED";
}

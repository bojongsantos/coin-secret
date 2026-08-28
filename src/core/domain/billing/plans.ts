/**
 * What Pro costs, and for how long.
 *
 * One monthly rate is the reference; the longer commitments are priced per
 * month against it and their headline savings are *derived*, never typed in.
 * A discount quoted in copy that the arithmetic does not support is the kind
 * of error nobody notices until a customer does.
 */

export type BillingPeriod = "monthly" | "sixMonth" | "annual";

export const BILLING_PERIODS: readonly BillingPeriod[] = ["monthly", "sixMonth", "annual"];

/** The rate every other option is measured against. */
export const MONTHLY_RATE_USD = 12;

export interface BillingPlan {
  id: BillingPeriod;
  /** Shown on the period switch. */
  label: string;
  months: number;
  /** Charged once, in whole US dollars. */
  totalUsd: number;
  /** What that works out to per month, for the headline figure. */
  perMonthUsd: number;
  /** Days of access one settled payment grants. */
  days: number;
}

const PLANS: Record<BillingPeriod, BillingPlan> = {
  monthly: { id: "monthly", label: "Bulanan", months: 1, totalUsd: 12, perMonthUsd: 12, days: 30 },
  sixMonth: { id: "sixMonth", label: "6 Bulan", months: 6, totalUsd: 60, perMonthUsd: 10, days: 180 },
  annual: { id: "annual", label: "Tahunan", months: 12, totalUsd: 96, perMonthUsd: 8, days: 365 },
};

export function billingPlan(period: BillingPeriod): BillingPlan {
  return PLANS[period];
}

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return typeof value === "string" && (BILLING_PERIODS as readonly string[]).includes(value);
}

/**
 * Percent saved against paying month by month, rounded to a whole number.
 *
 * Derived so the badge on the pricing page and the price beneath it can never
 * disagree.
 */
export function savingsPercent(period: BillingPeriod): number {
  const plan = PLANS[period];
  const atMonthlyRate = MONTHLY_RATE_USD * plan.months;
  if (atMonthlyRate === 0) return 0;
  return Math.round(((atMonthlyRate - plan.totalUsd) / atMonthlyRate) * 100);
}

/** `$12` — whole dollars, because every plan is priced in them. */
export function formatUsd(amount: number): string {
  return `$${amount}`;
}

import type { SubscriptionPlan } from "@/core/domain/identity";

export const REGISTRATION_TRIAL_DAYS = 7;

/** One trial per new registration; logging in again never restarts it. */
export function registrationTrialPeriod(createdAt: Date) {
  return {
    currentPeriodStart: createdAt,
    currentPeriodEnd: new Date(createdAt.getTime() + REGISTRATION_TRIAL_DAYS * 86_400_000),
  };
}

/**
 * Whether a stored Premium plan has run past its paid period.
 *
 * A Premium account with no period at all is left alone: that is how an admin
 * grants access by hand, and expiring it would quietly undo their decision.
 * The boundary counts as expired, since the period end is the first moment the
 * customer has no longer paid for.
 */
export function isSubscriptionExpired(
  plan: SubscriptionPlan,
  currentPeriodEnd: Date | null | undefined,
  now: Date,
): boolean {
  if (plan !== "PREMIUM") return false;
  if (currentPeriodEnd === null || currentPeriodEnd === undefined) return false;
  return currentPeriodEnd <= now;
}

/** The plan to act on once expiry has been taken into account. */
export function effectivePlan(
  plan: SubscriptionPlan,
  currentPeriodEnd: Date | null | undefined,
  now: Date,
): SubscriptionPlan {
  return isSubscriptionExpired(plan, currentPeriodEnd, now) ? "FREE" : plan;
}

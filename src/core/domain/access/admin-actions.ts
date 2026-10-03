import type { SubscriptionPlan, UserRole } from "@/core/domain/identity";

export interface UserChange {
  role?: UserRole;
  plan?: SubscriptionPlan;
}

export type UserChangeRejection = "EMPTY_CHANGE" | "SELF_DEMOTION" | null;

/**
 * Why an admin may not apply this change, or null when it is allowed.
 *
 * An admin cannot strip their own admin role. Without this an operator can
 * lock themselves out of the backoffice in one click, and since only an admin
 * can restore the role, nobody would be left able to undo it.
 *
 * The writer also rechecks authority and admin count transactionally to
 * protect against concurrent demotions.
 */
export function rejectUserChange(
  actorId: string,
  targetId: string,
  change: UserChange,
): UserChangeRejection {
  if (change.role === undefined && change.plan === undefined) return "EMPTY_CHANGE";
  if (actorId === targetId && change.role === "USER") return "SELF_DEMOTION";
  return null;
}

/** Subscription state that matches a plan an admin set by hand. */
export function subscriptionStatusForPlan(plan: SubscriptionPlan): "ACTIVE" | "INACTIVE" {
  return plan === "PREMIUM" ? "ACTIVE" : "INACTIVE";
}

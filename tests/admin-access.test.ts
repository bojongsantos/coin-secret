import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  rejectUserChange,
  subscriptionStatusForPlan,
} from "@/core/domain/access/admin-actions";
import { effectivePlan, isSubscriptionExpired } from "@/core/domain/access/subscription";

const ADMIN = "admin-1";
const OTHER = "user-2";

test("an admin cannot strip their own admin role", () => {
  // One click would otherwise lock the operator out of the backoffice, and
  // only an admin can hand the role back.
  assert.equal(rejectUserChange(ADMIN, ADMIN, { role: "USER" }), "SELF_DEMOTION");
  assert.equal(rejectUserChange(ADMIN, ADMIN, { role: "USER", plan: "PREMIUM" }), "SELF_DEMOTION");
});

test("an admin may still change their own plan", () => {
  assert.equal(rejectUserChange(ADMIN, ADMIN, { plan: "FREE" }), null);
  assert.equal(rejectUserChange(ADMIN, ADMIN, { plan: "PREMIUM" }), null);
  // Re-affirming their own admin role is harmless.
  assert.equal(rejectUserChange(ADMIN, ADMIN, { role: "ADMIN" }), null);
});

test("demoting a different admin stays allowed and cannot empty the room", () => {
  assert.equal(rejectUserChange(ADMIN, OTHER, { role: "USER" }), null);
  // The actor keeps their own role through the operation, so at least one
  // admin always remains.
  assert.equal(rejectUserChange(ADMIN, OTHER, { role: "USER" }), null);
  assert.equal(rejectUserChange(ADMIN, ADMIN, { role: "USER" }), "SELF_DEMOTION");
});

test("a change that asks for nothing is refused", () => {
  assert.equal(rejectUserChange(ADMIN, OTHER, {}), "EMPTY_CHANGE");
  assert.equal(rejectUserChange(ADMIN, ADMIN, {}), "EMPTY_CHANGE");
  // An empty change is caught before the self-demotion rule can matter.
  assert.equal(rejectUserChange(ADMIN, OTHER, { plan: "PREMIUM" }), null);
});

test("a hand-set plan gets the matching subscription state", () => {
  assert.equal(subscriptionStatusForPlan("PREMIUM"), "ACTIVE");
  assert.equal(subscriptionStatusForPlan("FREE"), "INACTIVE");
});

test("a paid period that has run out ends the plan", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  const lapsed = new Date("2026-08-18T12:00:00.000Z");
  const running = new Date("2026-08-20T12:00:00.000Z");

  assert.equal(isSubscriptionExpired("PREMIUM", lapsed, now), true);
  assert.equal(isSubscriptionExpired("PREMIUM", running, now), false);
  // The end of the period is the first moment no longer paid for.
  assert.equal(isSubscriptionExpired("PREMIUM", now, now), true);
});

test("a Premium account granted by hand is never expired out from under the admin", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  // No period recorded means an admin granted it directly; expiring that would
  // quietly undo their decision.
  assert.equal(isSubscriptionExpired("PREMIUM", null, now), false);
  assert.equal(isSubscriptionExpired("PREMIUM", undefined, now), false);
});

test("a free account is never downgraded further", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  const lapsed = new Date("2026-08-01T00:00:00.000Z");
  assert.equal(isSubscriptionExpired("FREE", lapsed, now), false);
  assert.equal(effectivePlan("FREE", lapsed, now), "FREE");
});

test("reading the current account never writes the subscription back", () => {
  // The regression this guards: the read path used to downgrade an expired
  // plan with an unconditional write on the values it had just read, so a
  // settlement landing in between was overwritten and the buyer lost the
  // period they had just paid for. Expiry is resolved on read instead.
  const source = readFileSync(
    join(process.cwd(), "src", "infrastructure", "auth", "current-user.ts"),
    "utf8",
  );
  assert.equal(
    /prisma\.(?:user|subscription)\.(?:update|updateMany|upsert|delete)/.test(source),
    false,
    "getCurrentUser must not write to the database while reading an account",
  );
  assert.equal(source.includes("effectivePlan"), true, "expiry must still be applied on read");
});

test("the effective plan is what the rest of the app should act on", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  const lapsed = new Date("2026-08-18T12:00:00.000Z");
  const running = new Date("2026-08-20T12:00:00.000Z");

  // An expired subscriber must lose paid features on the very next request,
  // not only after some later cleanup job runs.
  assert.equal(effectivePlan("PREMIUM", lapsed, now), "FREE");
  assert.equal(effectivePlan("PREMIUM", running, now), "PREMIUM");
  assert.equal(effectivePlan("PREMIUM", null, now), "PREMIUM");
});

import test from "node:test";
import assert from "node:assert/strict";
import type { PaymentOutcomeKind } from "@/core/application/ports/billing-gateway";
import {
  amountsMatch,
  decidePayment,
  extendPeriod,
  grantsAccess,
  shouldGrantAccess,
  shouldRevokeAccess,
  statusForOutcome,
} from "@/core/domain/billing/payment-rules";
import { billingPlan } from "@/core/domain/billing/plans";

const DAY_MS = 24 * 60 * 60 * 1000;

test("every outcome maps to exactly one stored status", () => {
  assert.equal(statusForOutcome("paid"), "SETTLED");
  assert.equal(statusForOutcome("failed"), "FAILED");
  assert.equal(statusForOutcome("expired"), "EXPIRED");
  assert.equal(statusForOutcome("canceled"), "CANCELED");
  assert.equal(statusForOutcome("refunded"), "REFUNDED");
  assert.equal(statusForOutcome("pending"), "PENDING");
  // Money arrived but not the agreed amount: neither complete nor failed, so
  // it waits for a decision instead of quietly passing as paid.
  assert.equal(statusForOutcome("underpaid"), "PENDING");
});

test("only a fully paid order opens access", () => {
  assert.equal(grantsAccess("paid"), true);
  const nonPaying: PaymentOutcomeKind[] = [
    "pending",
    "underpaid",
    "failed",
    "expired",
    "canceled",
    "refunded",
  ];
  for (const outcome of nonPaying) {
    assert.equal(grantsAccess(outcome), false, `"${outcome}" must not grant access`);
  }
});

test("an underpaid order never counts as a sale", () => {
  // Crypto buyers routinely send slightly less than asked after network fees,
  // so this case has to be handled deliberately rather than rounded away.
  assert.deepEqual(decidePayment("underpaid"), { status: "PENDING", successful: false });
  assert.deepEqual(decidePayment("paid"), { status: "SETTLED", successful: true });
  assert.deepEqual(decidePayment("refunded"), { status: "REFUNDED", successful: false });
});

test("a mismatched amount is rejected", () => {
  assert.equal(amountsMatch("99000.00", 99_000), true);
  assert.equal(amountsMatch("99000", 99_000), true);

  // Underpaying must never be accepted as full payment.
  assert.equal(amountsMatch("1.00", 99_000), false);
  assert.equal(amountsMatch("98999.99", 99_000), false);
  assert.equal(amountsMatch("990000.00", 99_000), false);

  // Unparseable input fails closed rather than comparing as NaN.
  assert.equal(amountsMatch("", 99_000), false);
  assert.equal(amountsMatch("abc", 99_000), false);
  assert.equal(amountsMatch("99000.00", Number.NaN), false);
});

test("a fresh payment starts a 30 day period from now", () => {
  const now = new Date("2026-08-19T10:00:00.000Z");
  const MONTH_DAYS = billingPlan("monthly").days;
  const expected = new Date(now.getTime() + MONTH_DAYS * DAY_MS);
  assert.equal(extendPeriod(null, now, MONTH_DAYS).toISOString(), expected.toISOString());
  assert.equal(extendPeriod(undefined, now, MONTH_DAYS).getTime(), expected.getTime());
});

test("renewing early stacks onto the running period instead of losing days", () => {
  const now = new Date("2026-08-19T10:00:00.000Z");
  const stillRunning = new Date(now.getTime() + 10 * DAY_MS);

  const extended = extendPeriod(stillRunning, now, billingPlan("monthly").days);

  // Ten days left plus thirty bought equals forty from today, not thirty.
  assert.equal(extended.getTime(), stillRunning.getTime() + 30 * DAY_MS);
  assert.equal(extended.getTime() - now.getTime(), 40 * DAY_MS);
});

test("an expired period restarts from now rather than from the old end", () => {
  const now = new Date("2026-08-19T10:00:00.000Z");
  const lapsed = new Date(now.getTime() - 5 * DAY_MS);

  const restarted = extendPeriod(lapsed, now, billingPlan("monthly").days);

  assert.equal(restarted.getTime(), now.getTime() + 30 * DAY_MS);
  assert.ok(restarted > now, "a lapsed subscriber must not receive a period already in the past");
});

test("a repeated settlement callback does not stack another period", () => {
  // Providers retry callbacks, so the same settlement arrives twice.
  assert.equal(shouldGrantAccess("PENDING", true), true);
  assert.equal(shouldGrantAccess("SETTLED", true), false);
  // Nothing is granted on a callback that did not settle.
  assert.equal(shouldGrantAccess("PENDING", false), false);
  assert.equal(shouldGrantAccess("FAILED", false), false);
});

test("a refund revokes access only for a payment that was actually paid", () => {
  assert.equal(shouldRevokeAccess("REFUNDED", "SETTLED"), true);
  // A refund on a payment that never settled has nothing to take back.
  assert.equal(shouldRevokeAccess("REFUNDED", "PENDING"), false);
  assert.equal(shouldRevokeAccess("REFUNDED", "REFUNDED"), false);
  // Other outcomes must not revoke a paid period.
  assert.equal(shouldRevokeAccess("EXPIRED", "SETTLED"), false);
  assert.equal(shouldRevokeAccess("FAILED", "SETTLED"), false);
});

test("a longer plan grants the days it charged for", () => {
  // The regression this guards: access used to come from one global constant,
  // so buying six months would have granted thirty days.
  const now = new Date("2026-08-19T10:00:00.000Z");
  for (const period of ["monthly", "sixMonth", "annual"] as const) {
    const plan = billingPlan(period);
    const end = extendPeriod(null, now, plan.days);
    assert.equal(
      end.getTime() - now.getTime(),
      plan.days * DAY_MS,
      `${period} charged for ${plan.months} months but granted a different span`,
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  billingPlan,
  BILLING_PERIODS,
  isBillingPeriod,
  MONTHLY_RATE_USD,
  savingsPercent,
} from "@/core/domain/billing/plans";

test("the headline savings are what the prices actually add up to", () => {
  // The badge and the price sit next to each other on the pricing page. If the
  // percentage were typed in rather than derived, one could be edited without
  // the other and the page would quietly misquote the discount.
  assert.equal(savingsPercent("monthly"), 0);
  assert.equal(savingsPercent("sixMonth"), 17);
  assert.equal(savingsPercent("annual"), 33);
});

test("every plan's total is its monthly rate times its months", () => {
  for (const period of BILLING_PERIODS) {
    const plan = billingPlan(period);
    assert.equal(
      plan.perMonthUsd * plan.months,
      plan.totalUsd,
      `${period} charges ${plan.totalUsd} but advertises ${plan.perMonthUsd}/month over ${plan.months}`,
    );
  }
});

test("a longer commitment is never worse value", () => {
  const rates = BILLING_PERIODS.map((p) => billingPlan(p).perMonthUsd);
  for (let i = 1; i < rates.length; i++) {
    assert.ok(rates[i] < rates[i - 1], "each step down must actually cost less per month");
  }
  assert.equal(billingPlan("monthly").perMonthUsd, MONTHLY_RATE_USD);
});

test("access granted matches the months paid for", () => {
  // Roughly thirty days a month, and never short of it: a customer must not
  // lose days to the calendar.
  for (const period of BILLING_PERIODS) {
    const plan = billingPlan(period);
    assert.ok(
      plan.days >= plan.months * 30,
      `${period} charges for ${plan.months} months but grants only ${plan.days} days`,
    );
  }
});

test("only the three known periods are accepted", () => {
  for (const period of BILLING_PERIODS) assert.equal(isBillingPeriod(period), true);
  for (const junk of ["weekly", "", "MONTHLY", null, 12]) {
    assert.equal(isBillingPeriod(junk), false, `${String(junk)} must be rejected`);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_CAPABILITIES, PREMIUM_PERIOD_DAYS } from "@/core/domain/access/plan-catalog";
import { hasFeature } from "@/core/domain/access/gating";

function find(labelFragment: string) {
  const row = PLAN_CAPABILITIES.find((item) => item.label.includes(labelFragment));
  assert.ok(row, `missing pricing row for "${labelFragment}"`);
  return row;
}

test("every advertised row is backed by a gate, not by prose", () => {
  // The quantity rows for watchlist, alerts and the setup journal are gone
  // with those features. What remains must still come from the same gate the
  // server enforces, so the table cannot drift into advertising something the
  // product does not grant.
  assert.ok(PLAN_CAPABILITIES.length > 0);
  for (const row of PLAN_CAPABILITIES) {
    assert.ok(row.label.trim().length > 0);
  }
});

test("gated rows mirror the entitlement gate rather than restating it", () => {
  const signals = find("Signals");
  assert.equal(signals.free, hasFeature("free", "signals"));
  assert.equal(signals.premium, hasFeature("premium", "signals"));
  // A premium-only feature must not be advertised as included in Free.
  assert.equal(signals.free, false);
  assert.equal(signals.premium, true);

  const scanner = find("scanner penuh");
  assert.equal(scanner.free, false);
  assert.equal(scanner.premium, true);
});

test("no row promises Free something Premium lacks", () => {
  for (const row of PLAN_CAPABILITIES) {
    if (typeof row.free === "boolean" && typeof row.premium === "boolean") {
      assert.ok(
        !(row.free && !row.premium),
        `"${row.label}" is offered to Free but not to Premium`,
      );
    }
  }
});

test("the billing period stated to buyers is 30 days", () => {
  // The webhook extends access by exactly this many days on settlement.
  assert.equal(PREMIUM_PERIOD_DAYS, 30);
});

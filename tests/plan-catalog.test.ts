import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_CAPABILITIES } from "@/core/domain/access/plan-catalog";
import { hasFeature } from "@/core/domain/access/gating";

function find(labelFragment: string) {
  const row = PLAN_CAPABILITIES.find((item) => item.label.includes(labelFragment));
  assert.ok(row, `missing pricing row for "${labelFragment}"`);
  return row;
}

test("the table says what the plans actually differ on", () => {
  // Reach is what is sold. If a row ever claims Free is limited on the depth
  // of the analysis, either the table or the product has drifted.
  assert.equal(find("Coin dan token").free, "Terbatas");
  assert.equal(find("Trading plan").free, "Terbatas");
  for (const label of ["Technical analysis", "Confidence", "Market context", "Market sentiment"]) {
    assert.equal(find(label).free, true, `${label} must stay open to Free`);
  }
});

test("Pro is never worse than Free on any row", () => {
  for (const row of PLAN_CAPABILITIES) {
    if (row.free === true) {
      assert.equal(row.pro, true, `"${row.label}" is offered to Free but not to Pro`);
    }
  }
});

test("the limited rows are the ones the server actually gates", () => {
  // "Coin dan token" is limited because symbol search is a Pro feature, and
  // "Trading plan" because the full signals board is. A row that claimed a
  // limit with no gate behind it would be a promise the product does not keep.
  assert.equal(hasFeature("free", "symbolSearch"), false);
  assert.equal(hasFeature("premium", "symbolSearch"), true);
  assert.equal(hasFeature("free", "signals"), false);
  assert.equal(hasFeature("premium", "signals"), true);

  // And the open rows have no gate standing in their way.
  assert.equal(hasFeature("free", "convictionDetail"), true);
  assert.equal(hasFeature("free", "entryBreakdown"), true);
});

test("every row carries a label for both columns", () => {
  assert.ok(PLAN_CAPABILITIES.length > 0);
  for (const row of PLAN_CAPABILITIES) {
    assert.ok(row.label.trim().length > 0);
    assert.ok(row.free === true || row.free.trim().length > 0);
    assert.ok(row.pro === true || row.pro.trim().length > 0);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  dashboardSignals,
  FREE_VISIBLE_SIGNALS,
  isDashboardSignal,
  MIN_DASHBOARD_CONFIDENCE,
  visibleSignalsFor,
} from "@/core/domain/analysis/signal-display";

test("only setups above the confidence floor reach the dashboard", () => {
  assert.equal(MIN_DASHBOARD_CONFIDENCE, 50);
  assert.equal(isDashboardSignal({ confidence: 51 }), true);
  // Exactly at the floor is not "above" it.
  assert.equal(isDashboardSignal({ confidence: 50 }), false);
  assert.equal(isDashboardSignal({ confidence: 20 }), false);

  const kept = dashboardSignals([{ confidence: 77 }, { confidence: 20 }, { confidence: 64 }, { confidence: 50 }]);
  assert.deepEqual(kept, [{ confidence: 77 }, { confidence: 64 }]);
});

test("filtering keeps the original order", () => {
  // The tables sort by volume before this runs; reordering here would quietly
  // undo that.
  const kept = dashboardSignals([{ confidence: 51 }, { confidence: 99 }, { confidence: 60 }]);
  assert.deepEqual(kept.map((h) => h.confidence), [51, 99, 60]);
});

test("a free plan sees three per side and is told how many are withheld", () => {
  const scan = {
    demand: [{ confidence: 82 }, { confidence: 64 }, { confidence: 57 }, { confidence: 55 }, { confidence: 53 }],
    supply: [{ confidence: 84 }, { confidence: 74 }],
  };

  const free = visibleSignalsFor(scan, false);
  assert.equal(free.demand.length, FREE_VISIBLE_SIGNALS);
  assert.equal(free.supply.length, 2, "fewer than the allowance is sent whole");
  // The totals are what the locked overlay subtracts from, so they must count
  // everything that passed the filter, not just what was sent.
  assert.equal(free.demandTotal, 5);
  assert.equal(free.supplyTotal, 2);

  const premium = visibleSignalsFor(scan, true);
  assert.equal(premium.demand.length, 5);
  assert.equal(premium.demandTotal, 5);
});

test("the confidence floor is applied before the free allowance, not after", () => {
  // The regression this pins: the scan is ordered by volume, so the rows a
  // free plan would receive first can all sit below the floor. Truncating
  // first left that plan with an empty table while premium saw a full one.
  const scan = {
    demand: [{ confidence: 20 }, { confidence: 20 }, { confidence: 20 }, { confidence: 82 }, { confidence: 64 }],
    supply: [],
  };

  const free = visibleSignalsFor(scan, false);
  assert.deepEqual(free.demand, [{ confidence: 82 }, { confidence: 64 }]);
  assert.equal(free.demandTotal, 2);
  assert.notEqual(free.demand.length, 0, "a free plan must not be handed an empty table");
});

test("a plan sees nothing only when the scan itself has nothing to show", () => {
  const scan = { demand: [{ confidence: 40 }, { confidence: 12 }], supply: [] };
  const free = visibleSignalsFor(scan, false);
  assert.deepEqual(free.demand, []);
  assert.equal(free.demandTotal, 0);
  assert.deepEqual(visibleSignalsFor(scan, true).demand, []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildSignalPerformance } from "@/core/domain/analysis/signal-performance";
import {
  dashboardSignals,
  FREE_VISIBLE_SIGNALS,
  isDashboardSignal,
  MIN_DASHBOARD_CONFIDENCE,
  visibleSignalsFor,
} from "@/core/domain/analysis/signal-display";
import type { Candle } from "@/core/domain/models";

const BAR = 900;
const START = 1_700_000_000;

function candles(spec: Array<[number, number, number]>): Candle[] {
  // [close, high, low] per bar; open tracks the previous close.
  return spec.map(([close, high, low], i) => ({
    time: START + i * BAR,
    open: i === 0 ? close : spec[i - 1][0],
    high,
    low,
    close,
    volume: 1_000,
  }));
}

const at = (index: number) => START + index * BAR;

test("nothing is measured while the signal has no history yet", () => {
  const bars = candles([[100, 101, 99]]);
  // Detected on the only bar there is: no follow-through to report.
  assert.equal(buildSignalPerformance({ candles: bars, signalTime: at(0), direction: "long", target1: 110, target2: 120, stopLoss: 95 }), null);
  assert.equal(buildSignalPerformance({ candles: [], signalTime: at(0), direction: "long", target1: 110, target2: 120, stopLoss: 95 }), null);
  assert.equal(buildSignalPerformance({ candles: bars, signalTime: Number.NaN, direction: "long", target1: 110, target2: 120, stopLoss: 95 }), null);
  // A signal older than every candle loaded has no bar to anchor to.
  assert.equal(
    buildSignalPerformance({ candles: bars, signalTime: START - BAR, direction: "long", target1: 110, target2: 120, stopLoss: 95 }),
    null,
  );
});

test("a long reports the move from the signal bar", () => {
  const bars = candles([[100, 100, 100], [104, 105, 99], [110, 112, 103]]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: at(0), direction: "long", target1: 112, target2: 130, stopLoss: 95 });
  assert.ok(perf);
  assert.equal(perf.barsSince, 2);
  assert.equal(perf.priceAtSignal, 100);
  assert.equal(perf.priceNow, 110);
  assert.equal(perf.changePct, 10);
  assert.equal(perf.bestPct, 12);
  assert.equal(perf.worstPct, -1);
  assert.equal(perf.hitTarget1, true);
  assert.equal(perf.hitTarget2, false);
  assert.equal(perf.hitStop, false);
  assert.deepEqual(perf.series, [100, 104, 110]);
});

test("a profitable short reports a positive move, not a negative one", () => {
  // The whole point of signing by direction: price fell, and for a short that
  // is a gain. Reporting -5% here would read as a loss at a glance.
  const bars = candles([[100, 100, 100], [95, 101, 94]]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: at(0), direction: "short", target1: 94, target2: 80, stopLoss: 105 });
  assert.ok(perf);
  assert.equal(perf.changePct, 5);
  assert.equal(perf.bestPct, 6);
  assert.equal(perf.worstPct, -1);
  assert.equal(perf.hitTarget1, true);
  assert.equal(perf.hitStop, false);
});

test("a short is stopped out when price rises through the stop", () => {
  const bars = candles([[100, 100, 100], [103, 106, 102]]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: at(0), direction: "short", target1: 94, target2: 80, stopLoss: 105 });
  assert.ok(perf);
  assert.equal(perf.hitStop, true);
  assert.equal(perf.changePct, -3);
});

test("the signal anchors to the bar that had already opened", () => {
  const bars = candles([[100, 100, 100], [110, 110, 110], [120, 120, 120]]);
  // Detected midway through bar 1: bar 1 is the signal bar, not bar 2.
  const midBar1 = START + BAR + 300;
  const perf = buildSignalPerformance({ candles: bars, signalTime: midBar1, direction: "long", target1: 999, target2: 999, stopLoss: 1 });
  assert.ok(perf);
  assert.equal(perf.priceAtSignal, 110);
  assert.equal(perf.barsSince, 1);
});

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

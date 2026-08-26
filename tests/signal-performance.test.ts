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

/**
 * The three bars the impulse occupies, priced well away from every level.
 *
 * `buildSignalPerformance` starts measuring where the status machine starts —
 * after the impulse that formed the zone. A fixture that begins at the signal
 * bar would be measuring bars the product itself ignores.
 */
const IMPULSE: Array<[number, number, number]> = [
  [100, 100, 100],
  [100, 100, 100],
  [100, 100, 100],
];

/** Signal bar plus the bars that followed, with the impulse prepended. */
function after(spec: Array<[number, number, number]>): Candle[] {
  return candles([...IMPULSE, ...spec]);
}

/** Index of the signal bar: the impulse is skipped, so it is bar 0. */
const SIGNAL = at(0);

test("nothing is measured while the signal has no history yet", () => {
  const bars = after([[100, 101, 99]]);
  // One bar after the impulse: no follow-through to report.
  const plan = { direction: "long" as const, entry: 100, target1: 110, target2: 120, stopLoss: 95 };
  assert.equal(buildSignalPerformance({ candles: bars, signalTime: SIGNAL, ...plan }), null);
  assert.equal(buildSignalPerformance({ candles: [], signalTime: SIGNAL, ...plan }), null);
  assert.equal(buildSignalPerformance({ candles: bars, signalTime: Number.NaN, ...plan }), null);
  // A signal older than every candle loaded has no bar to anchor to.
  assert.equal(
    buildSignalPerformance({ candles: bars, signalTime: START - BAR, ...plan }),
    null,
  );
});

test("the impulse that formed the zone is not counted as market history", () => {
  // The bug this pins: the impulse candle runs straight through the entry, so
  // measuring from the zone's base bar marked every setup filled — and let the
  // export claim a target on a plan the panel still showed as a limit order.
  const bars = candles([
    [100, 130, 70], // the impulse: sweeps entry, target and stop in one bar
    [100, 100, 100],
    [100, 100, 100],
    [100, 100, 100],
    [101, 101, 100],
  ]);
  const perf = buildSignalPerformance({
    candles: bars,
    signalTime: at(0),
    direction: "long",
    entry: 90,
    target1: 120,
    target2: 130,
    stopLoss: 80,
  });
  assert.ok(perf);
  assert.equal(perf.filled, false, "the impulse must not count as a fill");
  assert.equal(perf.hitTarget1, false);
  assert.equal(perf.hitStop, false);
});

test("a fill on the first measured bar still counts as a fill", () => {
  // The off-by-one this pins: excursions correctly skip the first bar of the
  // window, and the level checks used to skip it too. A setup that filled and
  // took target 1 on that very bar showed "Target 1 reached" in the plan next
  // to a block claiming the order had never triggered.
  const bars = after([
    [96, 101, 95], // first measured bar: trades through entry and target 1
    [96, 97, 95],
  ]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: SIGNAL, direction: "short", entry: 100, target1: 96, target2: 90, stopLoss: 105 });
  assert.ok(perf);
  assert.equal(perf.filled, true);
  assert.equal(perf.hitTarget1, true);
  // The excursion still skips that bar: its own high is not a drawdown from
  // its own close. Counting it would report -5.21% here instead of -1.04%.
  assert.equal(perf.worstPct, -1.04);
});

test("a long reports the move from the signal bar", () => {
  const bars = after([[100, 100, 100], [104, 105, 99], [110, 112, 103]]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: SIGNAL, direction: "long", entry: 100, target1: 112, target2: 130, stopLoss: 95 });
  assert.ok(perf);
  assert.equal(perf.barsSince, 2);
  assert.equal(perf.priceAtSignal, 100);
  assert.equal(perf.priceNow, 110);
  assert.equal(perf.changePct, 10);
  assert.equal(perf.bestPct, 12);
  assert.equal(perf.worstPct, -1);
  assert.equal(perf.filled, true);
  assert.equal(perf.hitTarget1, true);
  assert.equal(perf.hitTarget2, false);
  assert.equal(perf.hitStop, false);
  assert.deepEqual(perf.series, [100, 104, 110]);
});

test("a target price never traded to is not reported as reached", () => {
  // Price ran to the target without ever coming back to the limit. There is
  // no position, so there is nothing for the target to have paid out on.
  const bars = after([[100, 100, 100], [104, 105, 101], [110, 112, 103]]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: SIGNAL, direction: "long", entry: 99, target1: 112, target2: 130, stopLoss: 90 });
  assert.ok(perf);
  assert.equal(perf.filled, false, "the entry was never touched");
  assert.equal(perf.hitTarget1, false, "an unfilled order cannot reach a target");
});

test("a profitable short reports a positive move, not a negative one", () => {
  // The whole point of signing by direction: price fell, and for a short that
  // is a gain. Reporting -5% here would read as a loss at a glance.
  const bars = after([[100, 100, 100], [95, 101, 94]]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: SIGNAL, direction: "short", entry: 100, target1: 94, target2: 80, stopLoss: 105 });
  assert.ok(perf);
  assert.equal(perf.changePct, 5);
  assert.equal(perf.bestPct, 6);
  assert.equal(perf.worstPct, -1);
  assert.equal(perf.hitTarget1, true);
  assert.equal(perf.hitStop, false);
});

test("a short is stopped out when price rises through the stop", () => {
  const bars = after([[100, 100, 100], [103, 106, 102]]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: SIGNAL, direction: "short", entry: 100, target1: 94, target2: 80, stopLoss: 105 });
  assert.ok(perf);
  assert.equal(perf.hitStop, true);
  assert.equal(perf.changePct, -3);
});

test("the signal anchors to the bar that had already opened", () => {
  const bars = after([[100, 100, 100], [110, 110, 110], [120, 120, 120]]);
  // Detected midway through bar 1: bar 1 is the anchor, not bar 2, so the
  // measured window starts one bar later than it would for bar 0.
  const midBar1 = at(1) + 300;
  const perf = buildSignalPerformance({ candles: bars, signalTime: midBar1, direction: "long", entry: 100, target1: 999, target2: 999, stopLoss: 1 });
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

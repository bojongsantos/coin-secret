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
 * The impulse leg, which carries price clear of the entry.
 *
 * A setup is measured from the bar its order became placeable, not from the
 * bar its zone formed: the impulse runs straight through the entry, and
 * counting it made every setup look filled the moment it was detected.
 */
const IMPULSE: Array<[number, number, number]> = [
  [100, 100, 100],
  [104, 105, 100], // closes clear of the entry at 100: the order is now live
];

/** Signal bar plus the bars that followed, with the impulse prepended. */
function after(spec: Array<[number, number, number]>): Candle[] {
  return candles([...IMPULSE, ...spec]);
}

/** The zone's base bar — where the walk starts. */
const SIGNAL = at(0);

/** A long whose limit sits at 100. */
const LONG = { direction: "long" as const, entry: 100, target1: 112, target2: 130, stopLoss: 95 };

test("nothing is measured while the signal has no history yet", () => {
  assert.equal(buildSignalPerformance({ candles: after([]), signalTime: SIGNAL, ...LONG }), null);
  assert.equal(buildSignalPerformance({ candles: [], signalTime: SIGNAL, ...LONG }), null);
  assert.equal(buildSignalPerformance({ candles: after([[100, 101, 99]]), signalTime: Number.NaN, ...LONG }), null);
  // A signal older than every candle loaded has no bar to anchor to.
  assert.equal(buildSignalPerformance({ candles: after([[100, 101, 99]]), signalTime: START - BAR, ...LONG }), null);
});

test("a setup still inside its own impulse has not performed yet", () => {
  // Price has not closed clear of the entry, so no order could have been
  // placed and there is nothing to report on.
  const forming = candles([[100, 100, 100], [100, 100, 99], [100, 100, 99]]);
  assert.equal(buildSignalPerformance({ candles: forming, signalTime: SIGNAL, ...LONG }), null);
});

test("the impulse that formed the zone is not counted as a fill", () => {
  // The bug this pins: the impulse runs straight through the entry, so the
  // export claimed a target on a plan the panel still showed as a limit order.
  const bars = candles([
    [100, 130, 70], // the impulse: sweeps entry, target and stop in one bar
    [104, 105, 100],
    [104, 105, 101],
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

test("a long reports the move from the bar its order went live", () => {
  const bars = after([[100, 100, 99], [104, 105, 99], [110, 112, 103]]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: SIGNAL, ...LONG });
  assert.ok(perf);
  assert.equal(perf.priceAtSignal, 104, "measured from the armed bar, not the zone base");
  assert.equal(perf.priceNow, 110);
  assert.equal(perf.filled, true);
  assert.equal(perf.hitTarget1, true);
  assert.equal(perf.hitTarget2, false);
  assert.equal(perf.hitStop, false);
});

test("a target price never traded to is not reported as reached", () => {
  // Price ran to the target without ever coming back to the limit. There is
  // no position, so there is nothing for the target to have paid out on.
  const bars = after([[104, 105, 101], [110, 113, 105]]);
  const perf = buildSignalPerformance({ candles: bars, signalTime: SIGNAL, ...LONG });
  assert.ok(perf);
  assert.equal(perf.filled, false, "the entry was never touched");
  assert.equal(perf.hitTarget1, false, "an unfilled order cannot reach a target");
});

test("a profitable short reports a positive move, not a negative one", () => {
  // The whole point of signing by direction: price fell, and for a short that
  // is a gain. Reporting -5% here would read as a loss at a glance.
  const bars = candles([
    [100, 100, 100],
    [96, 100, 95], // closes clear below the entry at 100: order live
    [100, 101, 96], // trades back up to the limit: filled
    [95, 96, 94], // then falls to the first target
  ]);
  const perf = buildSignalPerformance({
    candles: bars,
    signalTime: at(0),
    direction: "short",
    entry: 100,
    target1: 94,
    target2: 80,
    stopLoss: 105,
  });
  assert.ok(perf);
  assert.equal(perf.filled, true);
  assert.equal(perf.hitTarget1, true);
  assert.equal(perf.hitStop, false);
  assert.ok(perf.changePct > 0, `a falling short must read positive, got ${perf.changePct}`);
});

test("a short is stopped out when price rises through the stop", () => {
  const bars = candles([
    [100, 100, 100],
    [96, 100, 95],
    [100, 101, 96], // filled
    [104, 106, 100], // through the stop at 105
  ]);
  const perf = buildSignalPerformance({
    candles: bars,
    signalTime: at(0),
    direction: "short",
    entry: 100,
    target1: 94,
    target2: 80,
    stopLoss: 105,
  });
  assert.ok(perf);
  assert.equal(perf.hitStop, true);
});

test("the signal anchors to the bar that had already opened", () => {
  const bars = candles([
    [100, 100, 100],
    [100, 100, 100],
    [104, 105, 100], // armed here
    [106, 107, 105],
  ]);
  // Detected midway through bar 1: bar 1 is the anchor, not bar 2.
  const perf = buildSignalPerformance({ candles: bars, signalTime: at(1) + 300, ...LONG });
  assert.ok(perf);
  assert.equal(perf.priceAtSignal, 104);
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

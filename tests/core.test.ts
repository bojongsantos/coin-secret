import test from "node:test";
import assert from "node:assert/strict";
import { buildPerformance, emaSeries, rsiSeries } from "@/core/domain/analysis/analysis-engine";
import {
  buildRiskTargets,
  computeSetupStatus,
  findSwingStopLoss,
  type SdZone,
} from "@/core/domain/analysis/supply-demand";
import type { Candle } from "@/core/domain/models";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1_000 };
}

const zone: SdZone = {
  id: "demand-test",
  type: "demand",
  top: 100,
  bottom: 95,
  baseIndex: 0,
  baseTime: 1,
  touches: 0,
  strength: "fresh",
  active: false,
  confidence: 80,
  narrowness: 0.8,
};

/**
 * The zone forms at bar 1, the impulse carries price clear of the entry by
 * bar 3, and `last` is what the market then did.
 *
 * Entry for this demand zone is 100, its top. The impulse rises away from it,
 * which is what leaves a limit order sitting below the market with somewhere
 * to wait.
 */
function history(...tail: Candle[]): Candle[] {
  return [
    candle(1, 100, 101, 99, 100),
    candle(2, 100, 103, 100, 102),
    candle(3, 102, 105, 102, 104), // closed clear of the entry: order is live
    ...tail,
  ];
}

/** The bar that trades back down to the entry and fills the limit. */
const FILL = candle(4, 102, 103, 99, 101);

test("setup state machine covers long outcomes", () => {
  const status = (bars: Candle[], price: number) =>
    computeSetupStatus(bars, zone, true, 100, 90, 110, 120, price);

  // Price still above the entry, never came back to it.
  assert.equal(status(history(candle(4, 104, 108, 101, 105)), 105), "Limit Order");
  // Ran to the first target without ever returning to the limit.
  assert.equal(status(history(candle(4, 105, 111, 104, 108)), 108), "Missed");
  // Traded back to the entry and sat there.
  assert.equal(status(history(candle(4, 101, 105, 99, 100)), 99), "Filled");
  assert.equal(status(history(FILL, candle(5, 101, 108, 100, 106)), 106), "Running");
  assert.equal(status(history(FILL, candle(5, 101, 105, 89, 92)), 92), "Invalidated (SL hit)");
  assert.equal(status(history(FILL, candle(5, 101, 121, 100, 119)), 119), "Target 2 reached");
  assert.equal(status(history(FILL, candle(5, 101, 112, 100, 111)), 111), "Target 1 reached");
});

test("a target reached on the fill bar itself is not claimed", () => {
  // One bar that both trades down to the limit and runs to the target cannot
  // show which happened first: the path 101 -> 121 -> 99 reaches the target
  // before the order exists. The claim waits for a bar that can prove it.
  const sameBar = history(candle(4, 101, 121, 99, 119));
  assert.equal(computeSetupStatus(sameBar, zone, true, 100, 90, 110, 120, 119), "Running");
});

test("a setup is not filled by the impulse that created it", () => {
  // The bug this pins. A supply zone's entry sits at its lower edge, so price
  // inside the freshly formed zone is already past the entry and the old rule
  // called it filled on the first bar it looked at — after which any dip read
  // as "Target 1 reached" on a trade nobody could have been in.
  const supply: SdZone = { ...zone, id: "supply-test", type: "supply", top: 105, bottom: 100 };
  const impulse: Candle[] = [
    candle(1, 104, 106, 100, 101), // the zone: price sits inside it, above 100
    candle(2, 101, 102, 100, 100.5),
    candle(3, 100.5, 101, 100.2, 100.4), // still inside, never left
  ];
  // Entry 100, stop 105, targets 95 and 90 — a short.
  assert.equal(
    computeSetupStatus(impulse, supply, false, 100, 105, 95, 90, 100.4),
    "Limit Order",
    "price never left the zone, so nothing can have been filled",
  );

  // Now the impulse completes: price closes below the entry and keeps going,
  // straight through both targets, without ever trading back up to the limit.
  const ran = [...impulse, candle(4, 100, 100, 94, 94), candle(5, 94, 94, 89, 89)];
  assert.equal(computeSetupStatus(ran, supply, false, 100, 105, 95, 90, 89), "Missed");

  // And the honest sequence: leave, come back to the limit, then fall to T1.
  const proper = [
    ...impulse,
    candle(4, 100, 100, 97, 97), // departed
    candle(5, 97, 100, 97, 99), // traded back to the entry: filled
    candle(6, 99, 99, 94, 95), // then fell to the first target
  ];
  assert.equal(computeSetupStatus(proper, supply, false, 100, 105, 95, 90, 95), "Target 1 reached");
});

test("a bar that touches both the stop and a target is resolved against the trade", () => {
  // Intrabar order is unknowable, so the loss is assumed and the win is not
  // claimed. Anything else lets the result archive publish a stopped-out
  // setup as a win.
  const both = history(FILL, candle(5, 101, 121, 89, 100));
  assert.equal(computeSetupStatus(both, zone, true, 100, 90, 110, 120, 100), "Invalidated (SL hit)");
});

test("protective stops use confirmed swings and remain outside the zone", () => {
  const longCandles = [
    candle(1, 100, 102, 98, 100),
    candle(2, 100, 101, 97, 99),
    candle(3, 99, 100, 94, 96),
    candle(4, 96, 99, 96, 98),
    candle(5, 98, 101, 97, 100),
    candle(6, 100, 102, 98, 101),
  ];
  const shortCandles = [
    candle(1, 100, 102, 98, 100),
    candle(2, 100, 104, 99, 103),
    candle(3, 103, 106, 101, 104),
    candle(4, 104, 105, 100, 101),
    candle(5, 101, 103, 98, 99),
    candle(6, 99, 101, 97, 100),
  ];

  assert.equal(findSwingStopLoss(longCandles, "long", 95), 94 * 0.999);
  assert.equal(findSwingStopLoss(shortCandles, "short", 105), 106 * 1.001);

  // A swing inside the zone must not pull the protective stop into the zone.
  assert.equal(findSwingStopLoss(longCandles, "long", 93), 93 * 0.999);
  assert.equal(findSwingStopLoss(shortCandles, "short", 107), 107 * 1.001);
  assert.deepEqual(buildRiskTargets(100, 90, "long"), { target1: 110, target2: 120 });
  assert.deepEqual(buildRiskTargets(100, 110, "short"), { target1: 90, target2: 80 });
});

test("indicators and historical statistics remain finite", () => {
  const closes = Array.from({ length: 90 }, (_, i) => 100 + Math.sin(i / 3) * 4 + i * 0.08);
  const candles = closes.map((close, i) => candle(i + 1, close - 0.4, close + 1.2, close - 1.2, close));
  const ema = emaSeries(closes, 20);
  const rsi = rsiSeries(closes, 14);
  assert.equal(ema.length, closes.length);
  assert.equal(rsi.length, closes.length);
  assert.ok(ema.every(Number.isFinite));
  assert.ok(rsi.every((value) => Number.isFinite(value) && value >= 0 && value <= 100));

  const performance = buildPerformance(candles);
  const maximumWalkForwardSamples = Math.ceil((candles.length - 52) / 3);
  assert.ok(performance.totalTrades >= 0 && performance.totalTrades <= maximumWalkForwardSamples);
  assert.ok(performance.successRate >= 0 && performance.successRate <= 100);
  assert.ok(Number.isFinite(performance.profitFactor));
});

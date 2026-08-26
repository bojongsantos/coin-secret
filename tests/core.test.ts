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

function history(last: Candle): Candle[] {
  return [
    candle(1, 100, 101, 99, 100),
    candle(2, 100, 101, 99, 100),
    candle(3, 100, 101, 99, 100),
    last,
  ];
}

test("setup state machine covers long outcomes", () => {
  assert.equal(computeSetupStatus(history(candle(4, 104, 108, 101, 105)), zone, true, 100, 90, 110, 120, 105), "Limit Order");
  assert.equal(computeSetupStatus(history(candle(4, 105, 111, 101, 108)), zone, true, 100, 90, 110, 120, 108), "Missed");
  assert.equal(computeSetupStatus(history(candle(4, 101, 105, 99, 100)), zone, true, 100, 90, 110, 120, 99), "Filled");
  assert.equal(computeSetupStatus(history(candle(4, 101, 108, 99, 106)), zone, true, 100, 90, 110, 120, 106), "Running");
  assert.equal(computeSetupStatus(history(candle(4, 101, 105, 89, 92)), zone, true, 100, 90, 110, 120, 92), "Invalidated (SL hit)");
  assert.equal(computeSetupStatus(history(candle(4, 101, 121, 99, 119)), zone, true, 100, 90, 110, 120, 119), "Target 2 reached");
  // The first target is reported in its own right. Calling it "Running" left
  // the plan panel and the exported performance block describing the same
  // trade differently on the same screen.
  assert.equal(computeSetupStatus(history(candle(4, 101, 112, 99, 111)), zone, true, 100, 90, 110, 120, 111), "Target 1 reached");
  // A target price reached without the entry ever filling is not a target
  // reached — there was no position to reach it with.
  assert.equal(computeSetupStatus(history(candle(4, 104, 112, 102, 111)), zone, true, 100, 90, 110, 120, 111), "Missed");
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

import test from "node:test";
import assert from "node:assert/strict";
import {
  averageTrueRange,
  buildReasoning,
  type ReasoningContext,
} from "@/core/domain/analysis/analysis-engine";
import type { Candle } from "@/core/domain/models";

function series(length: number, step: number, range: number): Candle[] {
  return Array.from({ length }, (_, i) => {
    const close = 100 + i * step;
    return {
      time: 1_700_000_000 + i * 900,
      open: close - step,
      high: close + range,
      low: close - range,
      close,
      volume: 1_000,
    };
  });
}

function riskPoints(candles: Candle[], ctx: ReasoningContext): string[] {
  const risk = buildReasoning(candles, ctx).find((section) => section.id === "risk");
  assert.ok(risk, "risk section missing");
  return risk.points;
}

const base: ReasoningContext = {
  sdName: "Demand Zone (78%)",
  confidence: 78,
  pair: "BTC/USDT",
  direction: "long",
  entry: 100,
  target1: 106,
  target2: 112,
  stopLoss: 97,
  status: "Limit Order",
  bias: "bullish",
  support: 96,
  resistance: 115,
  zoneStrength: "fresh",
  zoneTouches: 0,
};

test("average true range reflects the bar range it is given", () => {
  assert.equal(averageTrueRange([]), 0);
  assert.equal(averageTrueRange(series(2, 0, 0)), 0);
  const narrow = averageTrueRange(series(40, 0, 0.5));
  const wide = averageTrueRange(series(40, 0, 3));
  assert.ok(wide > narrow, "a wider bar range must produce a larger ATR");
});

test("risk management quotes this setup's own stop distance, not a fixed checklist", () => {
  const candles = series(60, 0.1, 1);
  const tight = riskPoints(candles, { ...base, entry: 100, stopLoss: 99.5 }).join(" ");
  const wide = riskPoints(candles, { ...base, entry: 100, stopLoss: 90 }).join(" ");

  assert.match(tight, /0\.50%/);
  assert.match(wide, /10\.00%/);
  assert.notEqual(tight, wide, "two different stops must not produce identical guidance");
});

// The assertions below read the default language, which is what an unstated
// locale produces. The wording is incidental — each one is checking a measured
// figure and the sentence it is carried in. `tests/i18n.test.ts` is where the
// two languages are held to each other.
test("position size shrinks as the stop widens", () => {
  const candles = series(60, 0.1, 1);
  // 1% of capital risked over a 0.5% stop allows a 200% position, capped at 100%.
  assert.match(riskPoints(candles, { ...base, stopLoss: 99.5 }).join(" "), /\*\*100\.0%\*\* of capital/);
  // Over a 10% stop the same 1% risk allows only a 10% position.
  assert.match(riskPoints(candles, { ...base, stopLoss: 90 }).join(" "), /\*\*10\.0%\*\* of capital/);
});

test("a stop inside one ATR is called out as noise-prone", () => {
  const volatile = series(60, 0, 4);
  const noisy = riskPoints(volatile, { ...base, entry: 100, stopLoss: 99.8 }).join(" ");
  const clear = riskPoints(volatile, { ...base, entry: 100, stopLoss: 70 }).join(" ");
  assert.match(noisy, /ordinary noise can reach it/);
  assert.doesNotMatch(clear, /ordinary noise can reach it/);
});

test("risk-reward below the 1:2 threshold is named as a shortfall", () => {
  const candles = series(60, 0.1, 1);
  const poor = riskPoints(candles, { ...base, entry: 100, stopLoss: 90, target2: 105 }).join(" ");
  const good = riskPoints(candles, { ...base, entry: 100, stopLoss: 98, target2: 112 }).join(" ");
  assert.match(poor, /under the 1:2 threshold/);
  assert.match(good, /clears the 1:2 minimum/);
});

test("a re-tested zone reports its touch count instead of claiming fresh liquidity", () => {
  const candles = series(60, 0.1, 1);
  const fresh = riskPoints(candles, { ...base, zoneStrength: "fresh", zoneTouches: 0 }).join(" ");
  const tested = riskPoints(candles, { ...base, zoneStrength: "tested", zoneTouches: 3 }).join(" ");
  assert.match(fresh, /has not been revisited/);
  assert.match(tested, /\*\*3×\*\*/);
});

test("invalidation follows the direction of the trade", () => {
  const candles = series(60, 0.1, 1);
  assert.match(riskPoints(candles, { ...base, direction: "long" }).join(" "), /closes below/);
  assert.match(riskPoints(candles, { ...base, direction: "short" }).join(" "), /closes above/);
});

test("without entry or stop the block says there is nothing to measure", () => {
  const candles = series(60, 0.1, 1);
  const points = riskPoints(candles, {
    sdName: "No Zone Setup",
    confidence: 0,
    pair: "BTC/USDT",
    bias: "neutral",
  });
  assert.deepEqual(points, [
    "There is no valid entry or stop yet, so there is no risk to measure.",
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildPerformance } from "@/core/domain/analysis/analysis-engine";
import { detectSupplyDemand } from "@/core/domain/analysis/supply-demand";
import type { Candle } from "@/core/domain/models";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1_000 };
}

function waitingSetup() {
  const candles = Array.from({ length: 38 }, (_, i) => candle(i, 100, 101, 99, 100));
  // Depart beyond entry without reaching T1 before the limit can be retested.
  candles.push(candle(38, 100, 103.5, 99.5, 103));
  candles.push(candle(39, 103, 103.5, 102, 102.5));
  const setup = detectSupplyDemand(candles).setup;
  assert.ok(setup, "fixture must produce a real setup");
  assert.equal(setup.status, "Limit Order");
  return { candles, setup };
}

test("performance preserves a fill that predates the evaluation window", () => {
  const { candles, setup } = waitingSetup();
  candles[39] = candle(39, 103, 103.5, setup.entry - 0.1, 102.5);
  assert.equal(detectSupplyDemand(candles).setup?.status, "Running");
  candles.push(candle(40, 102.5, setup.target2 + 1, 102, setup.target2));
  while (candles.length < 53) candles.push(candle(candles.length, 102, 103, 102, 102.5));
  const stats = buildPerformance(candles);
  assert.equal(stats.totalTrades, 1, "an existing fill needs no second touch of entry");
  assert.equal(stats.successRate, 100);
});

test("performance waits for departure before treating an entry touch as a fill", () => {
  const { candles } = waitingSetup();
  // Expansion creates demand, but its wick only touches the padded entry.
  candles[38] = candle(38, 100, 101.3, 97.1, 101.1);
  candles[39] = candle(39, 101.1, 101.3, 100, 100.5);
  const setup = detectSupplyDemand(candles).setup;
  assert.ok(setup);
  assert.equal(setup.status, "Limit Order");
  candles.push(candle(40, 100.5, setup.target2 + 1, setup.entry - 0.1, 101));
  while (candles.length < 53) candles.push(candle(candles.length, 100, 101, 99.5, 100));
  assert.equal(buildPerformance(candles).totalTrades, 0, "departure reaching targets is not a filled trade");
});

for (const direction of ["long", "short"] as const) {
  test(`performance does not credit a ${direction} target touched on the fill bar`, () => {
    const { candles, setup } = waitingSetup();
    candles.push(candle(40, 102.5, setup.target2 + 1, setup.entry - 0.1, 102));
    candles.push(candle(41, 102, 103, setup.stopLoss - 1, setup.stopLoss));
    // 53 bars allow exactly one evaluation at end=40 with a 12-bar horizon.
    while (candles.length < 53) candles.push(candle(candles.length, 98, 99, 97, 98));
    const series = direction === "long" ? candles : candles.map((c) =>
      candle(c.time, 200 - c.open, 200 - c.low, 200 - c.high, 200 - c.close));
    assert.equal(detectSupplyDemand(series.slice(0, 40)).setup?.direction, direction);
    const stats = buildPerformance(series);
    assert.equal(stats.totalTrades, 1);
    assert.equal(stats.successRate, 0, "same-bar target cannot outrank a later stop");
  });
}

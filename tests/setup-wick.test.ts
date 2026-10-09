import test from "node:test";
import assert from "node:assert/strict";
import { traceSetupLifecycle, type SetupPlan } from "@/core/domain/analysis/setup-lifecycle";
import { readPublishedSetup, type PublishedSetup } from "@/core/domain/analysis/supply-demand";
import type { Candle } from "@/core/domain/models";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1_000 };
}

// Captured Binance ZEC/USDT 1H candles, 2026-10-08 08:00 through 15:00 UTC.
// Keep the regression self-contained rather than depending on an audit report.
const zec: PublishedSetup = {
  direction: "short",
  entry: 1205.741,
  target1: 1152.98476,
  target2: 1100.2285200000001,
  stopLoss: 1258.49724,
  confidence: 52,
  zoneTop: 1251.319,
  zoneBottom: 1205.741,
  zoneBaseTime: 1791446400,
};
const zecBars = [
  candle(1791446400, 1239.32, 1246.06, 1232.7, 1235.36),
  candle(1791450000, 1235.36, 1244.01, 1211, 1226.99),
  candle(1791453600, 1227, 1228.59, 1194.47, 1208.65),
  candle(1791457200, 1208.75, 1212.28, 1197.18, 1208.77),
  candle(1791460800, 1208.74, 1212.68, 1196.38, 1206.49),
  candle(1791464400, 1206.6, 1222.02, 1199.39, 1213),
  candle(1791468000, 1213.09, 1217.11, 1203.41, 1207.91),
  candle(1791471600, 1207.9, 1207.98, 1128.71, 1144.11),
];

test("ZEC wick departure arms at 10:00, retest fills at 11:00, and 15:00 reaches T1", () => {
  const departed = traceSetupLifecycle(zecBars.slice(0, 3), zec, 0, 1208.65);
  assert.equal(departed.armedIndex, 2);
  assert.equal(departed.filledIndex, null);
  assert.equal(departed.status, "Limit Order");

  const filled = traceSetupLifecycle(zecBars.slice(0, 4), zec, 0, 1208.77);
  assert.equal(filled.filledIndex, 3);
  assert.equal(filled.status, "Filled");
  assert.equal(traceSetupLifecycle(zecBars.slice(0, 4), zec, 0, 1200).status, "Running");

  const reached = traceSetupLifecycle(zecBars, zec, 0, 1144.11);
  assert.equal(reached.armedIndex, 2);
  assert.equal(reached.filledIndex, 3);
  assert.equal(reached.target1Index, 7);
  assert.equal(reached.target2Index, null);
  assert.equal(reached.stopIndex, null);
  assert.equal(reached.missed, false);
  assert.equal(reached.status, "Target 1 reached");
  const published = readPublishedSetup(zecBars, zec, 1144.11);
  assert.equal(published.status, reached.status);
  assert.equal(published.setup?.status, reached.status);
  assert.equal(published.setup?.entry, zec.entry);
});

test("a demand wick can depart while closing inside and fill on the later retest", () => {
  const plan: SetupPlan = { direction: "long", entry: 100, stopLoss: 90, target1: 110, target2: 120 };
  const bars = [
    candle(1, 96, 98, 94, 95),
    candle(2, 95, 104, 95, 99), // wick above entry, close still inside demand
    candle(3, 99, 106, 98, 102), // a separate candle retests entry
    candle(4, 102, 111, 101, 109),
  ];
  const departure = traceSetupLifecycle(bars.slice(0, 2), plan, 0, 99);
  assert.equal(departure.armedIndex, 1);
  assert.equal(departure.filledIndex, null);
  const fill = traceSetupLifecycle(bars.slice(0, 3), plan, 0, 102);
  assert.equal(fill.filledIndex, 2);
  assert.equal(fill.status, "Running");
  const outcome = traceSetupLifecycle(bars, plan, 0, 109);
  assert.equal(outcome.target1Index, 3);
  assert.equal(outcome.status, "Target 1 reached");
});

test("touching entry exactly does not prove departure in either direction", () => {
  for (const direction of ["long", "short"] as const) {
    const long = direction === "long";
    const plan: SetupPlan = {
      direction, entry: 100, stopLoss: long ? 90 : 110,
      target1: long ? 110 : 90, target2: long ? 120 : 80,
    };
    const bars = long
      ? [candle(1, 97, 99, 95, 98), candle(2, 98, 100, 96, 99)]
      : [candle(1, 103, 105, 101, 102), candle(2, 102, 104, 100, 101)];
    const life = traceSetupLifecycle(bars, plan, 0, bars.at(-1)!.close);
    assert.equal(life.armedIndex, null, direction);
    assert.equal(life.filledIndex, null, direction);
    assert.equal(life.status, "Limit Order", direction);
  }
});

test("neither a base wick nor the departure candle fills its own limit", () => {
  for (const direction of ["long", "short"] as const) {
    const long = direction === "long";
    const plan: SetupPlan = {
      direction, entry: 100, stopLoss: long ? 90 : 110,
      target1: long ? 110 : 90, target2: long ? 120 : 80,
    };
    const bars = [
      candle(1, 100, 125, 75, 100), // history before the base is irrelevant
      candle(2, 100, 115, 85, 100), // base crosses entry, stop and T1
      long ? candle(3, 99, 104, 96, 99) : candle(3, 101, 104, 96, 101),
    ];
    const base = traceSetupLifecycle(bars.slice(0, 2), plan, 1, 100);
    assert.equal(base.armedIndex, null, direction);
    assert.equal(base.filledIndex, null, direction);
    const departure = traceSetupLifecycle(bars, plan, 1, bars.at(-1)!.close);
    assert.equal(departure.armedIndex, 2, direction);
    assert.equal(departure.filledIndex, null, direction);
    assert.equal(departure.missed, false, direction);
    assert.equal(departure.status, "Limit Order", direction);
  }
});

test("T1 on the departure candle cancels the limit before any later retest", () => {
  for (const direction of ["long", "short"] as const) {
    const long = direction === "long";
    const plan: SetupPlan = {
      direction, entry: 100, stopLoss: long ? 90 : 110,
      target1: long ? 110 : 90, target2: long ? 120 : 80,
    };
    const bars = long
      ? [
          candle(1, 96, 98, 94, 95),
          candle(2, 95, 111, 95, 99),
          candle(3, 99, 106, 98, 102),
          candle(4, 102, 121, 101, 119),
        ]
      : [
          candle(1, 104, 106, 102, 105),
          candle(2, 105, 105, 89, 101),
          candle(3, 101, 102, 94, 98),
          candle(4, 98, 99, 79, 81),
        ];
    const life = traceSetupLifecycle(bars, plan, 0, bars.at(-1)!.close);
    assert.equal(life.armedIndex, 1, direction);
    assert.equal(life.missed, true, direction);
    assert.equal(life.status, "Missed", direction);
    assert.equal(life.filledIndex, null, direction);
    assert.equal(life.target1Index, null, direction);
    assert.equal(life.target2Index, null, direction);
    assert.equal(life.stopIndex, null, direction);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { traceSetupLifecycle, type SetupPlan } from "@/core/domain/analysis/setup-lifecycle";
import { readPublishedSetup } from "@/core/domain/analysis/supply-demand";
import type { Candle } from "@/core/domain/models";

const bar = (time: number, open: number, high: number, low: number, close: number): Candle =>
  ({ time, open, high, low, close, volume: 100 });
const plan: SetupPlan = { direction: "long", entry: 100, target1: 110, target2: 120, stopLoss: 90 };
const before = [bar(0, 95, 99, 94, 96), bar(900, 96, 105, 96, 104),
  bar(1800, 104, 106, 99, 103), bar(2700, 103, 111, 102, 109)];

test("a newly published BTC-like demand plan cannot inherit an old entry and target", () => {
  assert.equal(traceSetupLifecycle(before, plan, 0, 109).status, "Target 1 reached");
  const life = traceSetupLifecycle(before, plan, 0, 109, 3000);
  assert.equal(life.status, "Limit Order");
  assert.equal(life.filledIndex, null);
  assert.equal(life.target1Index, null);
  const reading = readPublishedSetup(before, { ...plan, confidence: 75, zoneTop: 100,
    zoneBottom: 95, zoneBaseTime: 0, publishedAt: 3000 }, 109);
  assert.equal(reading.status, "Limit Order", "chart and scanner use the same publication cutoff");
});

test("only an entry after publication enables a subsequent target for long and short", () => {
  for (const direction of ["long", "short"] as const) {
    const mirror = (value: number) => direction === "long" ? value : 200 - value;
    const tape = [...before, bar(3600, 109, 109, 99, 103), bar(4500, 103, 111, 102, 110)]
      .map(c => direction === "long" ? c : ({ ...c, open: mirror(c.open), high: mirror(c.low), low: mirror(c.high), close: mirror(c.close) }));
    const levels = { direction, entry: 100, target1: mirror(110), target2: mirror(120), stopLoss: mirror(90) };
    const life = traceSetupLifecycle(tape, levels, 0, tape.at(-1)!.close, 3000);
    assert.equal(life.filledIndex, 4, direction);
    assert.equal(life.target1Index, 5, direction);
    assert.equal(life.status, "Target 1 reached", direction);
  }
});

test("a candle already open during publication cannot prove an entry from its earlier wick", () => {
  const tape = [...before, bar(3600, 109, 111, 99, 109)];
  const life = traceSetupLifecycle(tape, plan, 0, 109, 3600.001);
  assert.equal(life.filledIndex, null);
  assert.equal(life.target1Index, null);
  assert.equal(life.status, "Limit Order");
});

test("T1 reached after publication without a new entry cancels the pending order", () => {
  const tape = [...before, bar(3600, 109, 111, 103, 110), bar(4500, 110, 111, 99, 101)];
  const life = traceSetupLifecycle(tape, plan, 0, 101, 3000);
  assert.equal(life.status, "Missed");
  assert.equal(life.filledIndex, null);
  assert.equal(life.target1Index, null);
});

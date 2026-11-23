import test from "node:test";
import assert from "node:assert/strict";
import { traceSetupLifecycle, type SetupPlan } from "@/core/domain/analysis/setup-lifecycle";
import { detectSupplyDemand, readPublishedSetup } from "@/core/domain/analysis/supply-demand";
import type { Candle } from "@/core/domain/models";

const bar = (time: number, open: number, high: number, low: number, close: number): Candle =>
  ({ time, open, high, low, close, volume: 100 });
const longPlan: SetupPlan = { direction: "long", entry: 100, stopLoss: 90, target1: 110, target2: 120 };
const mirror = (value: number) => 200 - value;
const mirrored = (candle: Candle): Candle => ({ ...candle, open: mirror(candle.open),
  high: mirror(candle.low), low: mirror(candle.high), close: mirror(candle.close) });

test("first publication only offers long limits below price and short limits above price", () => {
  let offered = 0;
  for (let seed = 1; seed <= 100; seed++) {
    let rng = seed;
    let price = 100;
    const next = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
    const tape = Array.from({ length: 274 }, (_, i) => {
      const open = price;
      price = Math.max(1, price + (next() - 0.5) * (i % 17 === 0 ? 12 : 1.2));
      return bar(i * 900, open, Math.max(open, price) + next() * 0.4,
        Math.min(open, price) - next() * 0.4, price);
    });
    const setup = detectSupplyDemand(tape, { pendingOnly: true }).setup;
    if (!setup) continue;
    offered++;
    assert.ok(setup.direction === "long" ? price > setup.entry : price < setup.entry,
      `${setup.direction} limit entry ${setup.entry} is on the wrong side of price ${price}; seed ${seed}`);
  }
  assert.ok(offered > 0, "the publication fixture includes actionable pending orders");
});

for (const direction of ["long", "short"] as const) {
  const plan: SetupPlan = direction === "long" ? longPlan : { direction, entry: 100,
    stopLoss: 110, target1: 90, target2: 80 };
  const tapeFor = (tape: Candle[]) => direction === "long" ? tape : tape.map(mirrored);

  test(`${direction}: direct chart analysis does not advertise an unformed wrong-side limit`, () => {
    const tape = Array.from({ length: 38 }, (_, i) => bar(i, 100, 101, 99, 100));
    tape.push(bar(38, 100, 101.3, 97.1, 101.1), bar(39, 101.1, 101.3, 100, 100.5));
    assert.equal(detectSupplyDemand(tapeFor(tape)).setup, null);
  });

  test(`${direction}: a gap beyond entry and stop cancels without inventing a fill`, () => {
    const tape = tapeFor([bar(0, 95, 99, 94, 96), bar(900, 96, 105, 96, 104),
      bar(1800, 85, 89, 80, 82)]);
    const life = traceSetupLifecycle(tape, plan, 0, tape[2].close, 1700);
    assert.equal(life.status, "Missed");
    assert.equal(life.filledIndex, null);
    assert.equal(life.stopIndex, null);
    assert.equal(life.target1Index, null);
  });

  test(`${direction}: a gap across entry cancels before a later return even above the stop`, () => {
    const tape = tapeFor([bar(0, 95, 99, 94, 96), bar(900, 96, 105, 96, 104),
      bar(1800, 98, 99, 95, 97), bar(2700, 97, 105, 96, 104),
      bar(3600, 104, 111, 103, 110)]);
    const life = traceSetupLifecycle(tape, plan, 0, tape[4].close, 1700);
    assert.equal(life.status, "Missed");
    assert.equal(life.filledIndex, null);
    assert.equal(life.target1Index, null);
    assert.equal(life.stopIndex, null);
  });

  test(`${direction}: a setup that never departed cannot wait forever beyond invalidation`, () => {
    const tape = tapeFor([bar(0, 95, 99, 94, 96), bar(900, 96, 98, 92, 94),
      bar(1800, 94, 95, 89, 91)]);
    const reading = readPublishedSetup(tape, { ...plan, zoneTop: 100, zoneBottom: 95,
      zoneBaseTime: 0, publishedAt: 1700, confidence: 70 }, tape[2].close);
    assert.equal(reading.status, "Missed");
    assert.equal(reading.setup, null);
  });

  test(`${direction}: a post-publication entry wick followed by stop remains a real loss`, () => {
    const tape = tapeFor([bar(0, 95, 99, 94, 96), bar(900, 96, 105, 96, 104),
      bar(1800, 104, 105, 99, 101), bar(2700, 101, 102, 89, 91)]);
    const life = traceSetupLifecycle(tape, plan, 0, tape[3].close, 1700);
    assert.equal(life.status, "Invalidated (SL hit)");
    assert.equal(life.filledIndex, 2);
    assert.equal(life.stopIndex, 3);
  });

  test(`${direction}: a published pending order cannot remain on the wrong side of price`, () => {
    const tape = tapeFor([bar(0, 95, 99, 94, 96), bar(900, 96, 99, 95, 98),
      bar(1800, 98, 99, 96, 97)]);
    const life = traceSetupLifecycle(tape, plan, 0, tape[2].close, 1700);
    assert.equal(life.status, "Missed");
    assert.equal(life.filledIndex, null);
    assert.equal(life.target1Index, null);
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  detectSupplyDemand,
  ZONE_SCAN_WINDOW,
} from "@/core/domain/analysis/supply-demand";
import type { Candle } from "@/core/domain/models";

/** Deterministic series with impulses, so zones are actually produced. */
function series(count: number, seed = 1): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  let rng = seed;
  const next = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648;
  };
  for (let i = 0; i < count; i++) {
    const impulse = i % 17 === 0;
    const move = impulse ? (next() - 0.5) * 12 : (next() - 0.5) * 1.2;
    const open = price;
    price = Math.max(1, price + move);
    const high = Math.max(open, price) + next() * 0.4;
    const low = Math.min(open, price) - next() * 0.4;
    out.push({ time: 1_700_000_000 + i * 900, open, high, low, close: price, volume: 50 + next() * 50 });
  }
  return out;
}

test("zone detection ignores history beyond its own window", () => {
  // The scanner and the analysis page hand in different amounts of history.
  // If detection depended on that, the signals table could advertise a setup
  // the chart does not show — which is exactly what users reported.
  const long = series(1_000);
  const short = long.slice(-ZONE_SCAN_WINDOW);

  const fromLong = detectSupplyDemand(long);
  const fromShort = detectSupplyDemand(short);

  assert.deepEqual(
    fromLong.zones.map((zone) => [zone.type, zone.top, zone.bottom, zone.strength]),
    fromShort.zones.map((zone) => [zone.type, zone.top, zone.bottom, zone.strength]),
    "the same trailing window must yield the same zones",
  );
  assert.equal(fromLong.setup?.entry ?? null, fromShort.setup?.entry ?? null);
  assert.equal(fromLong.setup?.status ?? null, fromShort.setup?.status ?? null);
  assert.equal(fromLong.setup?.direction ?? null, fromShort.setup?.direction ?? null);
});

test("a setup either exists for both callers or for neither", () => {
  for (const seed of [3, 11, 29, 47]) {
    const long = series(800, seed);
    const short = long.slice(-ZONE_SCAN_WINDOW);
    const a = detectSupplyDemand(long);
    const b = detectSupplyDemand(short);
    assert.equal(
      a.setup === null,
      b.setup === null,
      `seed ${seed}: one caller saw a setup while the other did not`,
    );
    if (a.setup && b.setup) {
      // Not just present in both, but the same setup. The table listing a pair
      // under Demand while its own chart called it a Supply Zone is what this
      // pins: the two readings must agree on side, confidence and status, not
      // merely on whether something exists.
      assert.equal(a.setup.direction, b.setup.direction, `seed ${seed}: direction differs`);
      assert.equal(a.setup.confidence, b.setup.confidence, `seed ${seed}: confidence differs`);
      assert.equal(a.setup.status, b.setup.status, `seed ${seed}: status differs`);
      assert.equal(a.setup.entry, b.setup.entry, `seed ${seed}: entry differs`);
      assert.equal(a.setup.stopLoss, b.setup.stopLoss, `seed ${seed}: stop differs`);
    }
  }
});

test("detection is a pure function of the candles handed in", () => {
  // The regression this pins: a per-browser lock could freeze one reader's
  // setup while the server recomputed a different one, so the same symbol
  // showed a Demand Zone in the table and a Supply Zone on the chart. Calling
  // twice with the same input must give the same answer, every time.
  const candles = series(600, 19);
  const first = detectSupplyDemand(candles);
  const second = detectSupplyDemand(candles);
  assert.deepEqual(first.setup, second.setup);
  assert.deepEqual(first.zones, second.zones);
  // And there is no second argument left that could change it: the signature
  // itself now makes a per-caller answer impossible.
  assert.equal(detectSupplyDemand.length, 1, "detection takes candles and nothing else");
});

test("a caller with less than the window still gets a usable result", () => {
  const brief = series(60);
  const result = detectSupplyDemand(brief);
  assert.ok(Array.isArray(result.zones));
  assert.ok(Number.isFinite(result.support));
  assert.ok(Number.isFinite(result.resistance));
});

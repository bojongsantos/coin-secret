import test from "node:test";
import assert from "node:assert/strict";
import { setupOutcomeSince } from "@/core/domain/analysis/supply-demand";
import type { Candle } from "@/core/domain/models";

const LOCKED_AT = 1_700_000_000_000; // ms
const START = LOCKED_AT / 1_000;

function bars(spec: Array<[number, number, number]>, from = START): Candle[] {
  // [high, low, close] per bar.
  return spec.map(([high, low, close], i) => ({
    time: from + i * 900,
    open: close,
    high,
    low,
    close,
    volume: 1,
  }));
}

const LONG = { direction: "long" as const, stopLoss: 95, target2: 120, runningSince: LOCKED_AT };
const SHORT = { direction: "short" as const, stopLoss: 105, target2: 80, runningSince: LOCKED_AT };

test("a setup still between its levels stays running", () => {
  const candles = bars([[104, 99, 102], [106, 101, 105]]);
  assert.equal(setupOutcomeSince(candles, LONG, 105), null);
});

test("a wick through the stop ends the setup even after price recovers", () => {
  // The bug this pins: the stop was pierced and price came back before the
  // next read, so a spot-price check saw nothing and the screen kept saying
  // "Running" long after the trade was over.
  const candles = bars([[104, 99, 102], [103, 94, 101], [106, 100, 104]]);
  assert.equal(setupOutcomeSince(candles, LONG, 104), "stopped");
});

test("a spike through the second target counts even if price retraces", () => {
  const candles = bars([[104, 99, 102], [121, 110, 112], [115, 108, 110]]);
  assert.equal(setupOutcomeSince(candles, LONG, 110), "target");
});

test("the stop wins when both levels were touched in the same window", () => {
  // Intrabar order is unknowable, so the losing outcome is the honest one.
  const candles = bars([[121, 94, 110]]);
  assert.equal(setupOutcomeSince(candles, LONG, 110), "stopped");
});

test("bars from before the lock are ignored", () => {
  // Price may have been anywhere before the setup started running; only what
  // happened while it was live can decide it.
  const earlier = bars([[104, 90, 100]], START - 10_000);
  assert.equal(setupOutcomeSince(earlier, LONG, 104), null);
});

test("the spot price still decides when no bar has closed yet", () => {
  // A lock taken seconds ago has no candles of its own; the live price is all
  // there is to go on.
  assert.equal(setupOutcomeSince([], LONG, 94), "stopped");
  assert.equal(setupOutcomeSince([], LONG, 121), "target");
  assert.equal(setupOutcomeSince([], LONG, 110), null);
});

test("a short is decided by the mirrored levels", () => {
  const stopped = bars([[106, 99, 101]]);
  assert.equal(setupOutcomeSince(stopped, SHORT, 101), "stopped");

  const hit = bars([[101, 79, 82]]);
  assert.equal(setupOutcomeSince(hit, SHORT, 82), "target");

  const running = bars([[102, 96, 98]]);
  assert.equal(setupOutcomeSince(running, SHORT, 98), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { chartCandleUpdates } from "@/presentation/features/analysis/chart-updates";
import type { Candle } from "@/core/domain/models";

const bars: Candle[] = [1, 2, 3].map((time) => ({ time, open: 10, high: 12, low: 9, close: 11, volume: 1 }));

test("REST corrections update closed candles even when series length is unchanged", () => {
  const corrected = bars.map((bar, index) => index === 1 ? { ...bar, high: 14 } : bar);
  assert.deepEqual(chartCandleUpdates(bars, corrected), [{ candle: corrected[1], historical: true }]);
});

test("recovery corrects the old tail before appending all missed bars", () => {
  const corrected = [...bars.slice(0, -1), { ...bars[2], close: 12 }, { ...bars[2], time: 4 }, { ...bars[2], time: 5 }];
  assert.deepEqual(chartCandleUpdates(bars, corrected), corrected.slice(2).map((candle) => ({ candle, historical: false })));
});

test("a new market, prepended history or inserted timestamp requires a full upload", () => {
  assert.equal(chartCandleUpdates(null, bars), null);
  assert.equal(chartCandleUpdates(bars, [{ ...bars[0], time: 0 }, ...bars]), null);
  assert.equal(chartCandleUpdates(bars, [bars[0], { ...bars[1], time: 1.5 }, bars[2]]), null);
  assert.equal(chartCandleUpdates(bars, bars.slice(0, 2)), null);
});

test("identical data and volume-only changes do not redraw candle geometry", () => {
  assert.deepEqual(chartCandleUpdates(bars, bars), []);
  assert.deepEqual(chartCandleUpdates(bars, bars.map((bar) => ({ ...bar, volume: 7 }))), []);
  const live = [...bars.slice(0, -1), { ...bars[2], close: 12 }];
  assert.deepEqual(chartCandleUpdates(bars, live), [{ candle: live[2], historical: false }]);
});

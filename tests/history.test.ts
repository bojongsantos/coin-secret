import test from "node:test";
import assert from "node:assert/strict";
import { ZONE_SCAN_WINDOW } from "@/core/domain/analysis/supply-demand";
import {
  loadHistory,
  HISTORY_PAGE_SIZE,
  MAX_HISTORY_CANDLES,
} from "@/core/application/market-data/history-loader";
import {
  estimateRangeCandles,
  isHistoryRange,
  rangeForTimeframe,
  planHistoryPages,
  resolveRangeStart,
} from "@/core/application/market-data/history-plan";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import { TIMEFRAME_SECONDS } from "@/core/domain/market/timeframe";
import type { Candle, MarketTicker, Timeframe } from "@/core/domain/models";

const DAY = 86_400;

test("bounded ranges never reach past the listing date", () => {
  const now = 1_700_000_000;
  const listedLongAgo = now - 900 * DAY;
  const listedRecently = now - 10 * DAY;

  assert.equal(resolveRangeStart("1M", listedLongAgo, now), now - 30 * DAY);
  assert.equal(resolveRangeStart("1Y", listedLongAgo, now), now - 365 * DAY);
  // A coin listed ten days ago has ten days of history, not a year of blanks.
  assert.equal(resolveRangeStart("1Y", listedRecently, now), listedRecently);
  assert.equal(resolveRangeStart("ALL", listedLongAgo, now), listedLongAgo);
  assert.ok(isHistoryRange("ALL"));
  assert.equal(isHistoryRange("2Y"), false);
});

test("a bounded range asks for exactly its own window at each interval", () => {
  // A month of daily candles is ~31 bars, not a full 1000-bar page — the first
  // fetch must not pad a short range with history the user did not select.
  assert.equal(estimateRangeCandles("1M", "1D"), 31);
  assert.equal(estimateRangeCandles("3M", "1D"), 91);
  assert.equal(estimateRangeCandles("1Y", "1D"), 366);
  assert.equal(estimateRangeCandles("1M", "15m"), 2_881);
  // ALL is open-ended: only the listing date and the budget bound it.
  assert.equal(estimateRangeCandles("ALL", "1D"), null);
});

test("pages tile the window completely and without gaps", () => {
  const step = TIMEFRAME_SECONDS["15m"];
  const from = 1_600_000_000 - (1_600_000_000 % step);
  const to = from + 2_500 * step;

  const plan = planHistoryPages({
    fromSeconds: from,
    toSeconds: to,
    timeframe: "15m",
    pageSize: 1_000,
    maxCandles: 100_000,
  });

  assert.equal(plan.truncated, false);
  assert.equal(plan.fromSeconds, from);
  assert.equal(plan.estimatedCandles, 2_501);
  assert.equal(plan.pageStarts.length, 3);
  // Each page begins exactly one candle after the previous page's last candle.
  assert.deepEqual(plan.pageStarts, [
    from * 1_000,
    (from + 1_000 * step) * 1_000,
    (from + 2_000 * step) * 1_000,
  ]);
});

test("the candle budget clips the window and says so", () => {
  const step = TIMEFRAME_SECONDS["15m"];
  const to = 1_700_000_000 - (1_700_000_000 % step);
  const from = to - 50_000 * step;

  const plan = planHistoryPages({
    fromSeconds: from,
    toSeconds: to,
    timeframe: "15m",
    pageSize: 1_000,
    maxCandles: 5_000,
  });

  assert.equal(plan.truncated, true);
  assert.equal(plan.estimatedCandles, 5_000);
  assert.equal(plan.pageStarts.length, 5);
  assert.equal(plan.fromSeconds, to - 4_999 * step);
});

test("a lifetime intraday request stays inside the candle budget", () => {
  const now = 1_760_000_000;
  const listedIn2017 = now - 8 * 365 * DAY;

  const plan = planHistoryPages({
    fromSeconds: resolveRangeStart("ALL", listedIn2017, now),
    toSeconds: now,
    timeframe: "15m",
    pageSize: HISTORY_PAGE_SIZE,
    maxCandles: MAX_HISTORY_CANDLES,
  });

  assert.ok(plan.estimatedCandles <= MAX_HISTORY_CANDLES);
  assert.ok(plan.pageStarts.length <= Math.ceil(MAX_HISTORY_CANDLES / HISTORY_PAGE_SIZE));
});

test("a window shorter than one candle still yields a single page", () => {
  const plan = planHistoryPages({
    fromSeconds: 1_000,
    toSeconds: 1_000,
    timeframe: "1D",
    pageSize: 1_000,
    maxCandles: 1_000,
  });

  assert.equal(plan.pageStarts.length, 1);
  assert.equal(plan.estimatedCandles, 1);
  assert.equal(plan.truncated, false);
});

/** Serves candles from a synthetic market that opened at `listing`. */
function fakeMarket(listing: number, timeframe: Timeframe, now: number): MarketDataPort {
  const step = TIMEFRAME_SECONDS[timeframe];
  return {
    async fetchKlines(query) {
      const limit = query.limit ?? 100;
      const out: Candle[] = [];
      if (query.startTime !== undefined) {
        const start = Math.max(listing, Math.floor(query.startTime / 1_000));
        for (let time = start; time <= now && out.length < limit; time += step) {
          if (time >= listing) out.push({ time, open: 1, high: 2, low: 0, close: 1, volume: 1 });
        }
        return out;
      }
      // No window: the newest `limit` candles.
      for (let time = now; time >= listing && out.length < limit; time -= step) {
        out.unshift({ time, open: 1, high: 2, low: 0, close: 1, volume: 1 });
      }
      return out;
    },
    async fetchTicker24h(symbol: string): Promise<MarketTicker> {
      return {
        symbol,
        lastPrice: 1,
        priceChange: 0,
        priceChangePercent: 0,
        highPrice: 1,
        lowPrice: 1,
        quoteVolume: 0,
        volume: 0,
      };
    },
    async fetchTickers24h() {
      return [];
    },
  };
}

test("a lifetime load returns one continuous series from listing to now", async () => {
  const step = TIMEFRAME_SECONDS["1D"];
  const now = 1_700_000_000 - (1_700_000_000 % step);
  const listing = now - 2_400 * step;
  const progress: number[] = [];

  const loaded = await loadHistory({
    marketData: fakeMarket(listing, "1D", now),
    symbol: "BTCUSDT",
    timeframe: "1D",
    range: "ALL",
    nowSeconds: now,
    listingSeconds: listing,
    onProgress: (value) => progress.push(value.loadedPages),
  });

  assert.equal(loaded.truncated, false);
  assert.equal(loaded.candles[0].time, listing);
  assert.equal(loaded.candles.at(-1)!.time, now);
  assert.equal(loaded.candles.length, 2_401);
  // Strictly ascending with no duplicates and no gaps.
  for (let i = 1; i < loaded.candles.length; i++) {
    assert.equal(loaded.candles[i].time - loaded.candles[i - 1].time, step);
  }
  assert.equal(progress.at(-1), 3);
});

test("intraday timeframes reach the listing date too, not just 1D", async () => {
  const step = TIMEFRAME_SECONDS["15m"];
  const now = 1_700_000_000 - (1_700_000_000 % step);
  const listing = now - 5_000 * step;

  const loaded = await loadHistory({
    marketData: fakeMarket(listing, "15m", now),
    symbol: "ETHUSDT",
    timeframe: "15m",
    range: "ALL",
    nowSeconds: now,
    listingSeconds: listing,
  });

  assert.equal(loaded.candles[0].time, listing);
  assert.equal(loaded.candles.length, 5_001);
});

test("partials are disjoint older stretches that rebuild one continuous run", async () => {
  const step = TIMEFRAME_SECONDS["1H"];
  const now = 1_700_000_000 - (1_700_000_000 % step);
  const listing = now - 3_500 * step;
  const partials: Candle[][] = [];

  const loaded = await loadHistory({
    marketData: fakeMarket(listing, "1H", now),
    symbol: "SOLUSDT",
    timeframe: "1H",
    range: "ALL",
    nowSeconds: now,
    listingSeconds: listing,
    onPartial: (candles) => partials.push(candles),
  });

  assert.ok(partials.length > 1, "a multi-page load should emit more than one stretch");

  for (const batch of partials) {
    assert.ok(batch.length > 0, "an empty stretch is not worth emitting");
    for (let i = 1; i < batch.length; i++) {
      assert.equal(batch[i].time - batch[i - 1].time, step, "a stretch must not contain gaps");
    }
  }

  // Each stretch is strictly older than the one before it, so a consumer can
  // prepend rather than merge. Re-emitting the whole accumulated series here
  // is what previously turned the load into O(n^2) work.
  for (let i = 1; i < partials.length; i++) {
    const previousOldest = partials[i - 1][0].time;
    assert.ok(
      partials[i].at(-1)!.time < previousOldest,
      "stretches must not overlap the ones already emitted",
    );
  }

  // Prepending them in emission order reproduces the final series exactly.
  const rebuilt = [...partials].reverse().flat();
  assert.deepEqual(
    rebuilt.map((candle) => candle.time),
    loaded.candles.map((candle) => candle.time),
  );
  assert.equal(rebuilt[0].time, listing);
  assert.equal(rebuilt.at(-1)!.time, now);
});

test("every timeframe loads enough history to detect on", () => {
  // The regression this pins: the chart and the signals table run the same
  // detector over the last ZONE_SCAN_WINDOW bars. A range that supplies fewer
  // than that leaves the chart reading a shorter market than the table did,
  // and the two disagree about the very setup the reader just clicked.
  // Every chartable interval, not just the ones currently offered: a stored
  // setup or an old link can still name one of the slower charts.
  for (const timeframe of Object.keys(TIMEFRAME_SECONDS) as Timeframe[]) {
    const range = rangeForTimeframe(timeframe);
    const candles = estimateRangeCandles(range, timeframe);
    if (candles === null) continue; // "ALL" is unbounded
    assert.ok(
      candles >= ZONE_SCAN_WINDOW,
      `${timeframe} at ${range} loads ${candles} candles, short of ${ZONE_SCAN_WINDOW}`,
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import type { MarketDataPort, MarketDataSource } from "@/core/application/ports/market-data-port";
import { createTickerBatches, fetchPublishedCandles, loadMarketSnapshot } from "@/core/application/market-data/source-selection";
import type { Candle, MarketTicker } from "@/core/domain/models";

const candle = (close: number): Candle => ({ time: 1000, open: close, high: close, low: close, close, volume: 10 });
const ticker = (lastPrice: number): MarketTicker => ({ symbol: "BTCUSDT", lastPrice, priceChange: 1,
  priceChangePercent: 1, quoteVolume: 100, volume: 1, highPrice: lastPrice, lowPrice: lastPrice });
function source(exchange: "binance" | "bybit", price: number, overrides: Partial<MarketDataPort> = {}): MarketDataSource {
  return { exchange, marketData: { fetchKlines: async () => [candle(price)], fetchTicker24h: async () => ticker(price),
    fetchTickers24h: async () => [ticker(price)], ...overrides } };
}
const query = { symbol: "BTCUSDT", timeframe: "15m" as const };

test("initial fallback discards a partial exchange snapshot and selects both ticker and candles from one source", async () => {
  const first = source("binance", 100, { fetchTicker24h: async () => { throw new Error("blocked"); } });
  const second = source("bybit", 200);
  const result = await loadMarketSnapshot([first, second], query);
  assert.equal(result.exchange, "bybit");
  assert.equal(result.marketData, second.marketData);
  assert.equal(result.ticker.lastPrice, 200);
  assert.equal(result.candles[0].close, 200);
});

test("a rejected sibling read drains before selecting the fallback exchange", async () => {
  let finish!: (value: Candle[]) => void;
  let secondaryCalls = 0;
  const first = source("binance", 100, {
    fetchKlines: () => new Promise((resolve) => { finish = resolve; }),
    fetchTicker24h: async () => { throw new Error("early failure"); },
  });
  const second = source("bybit", 200, { fetchKlines: async () => { secondaryCalls++; return [candle(200)]; } });
  const pending = loadMarketSnapshot([first, second], query);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(secondaryCalls, 0);
  finish([candle(100)]);
  assert.equal((await pending).exchange, "bybit");
  assert.equal(secondaryCalls, 1);
});

test("published source failures never fall through to another exchange or produce a proof for legacy provenance", async () => {
  let alternateCalls = 0;
  const first = source("binance", 100, { fetchKlines: async () => { throw new Error("blocked"); } });
  const second = source("bybit", 200, { fetchKlines: async () => { alternateCalls++; return [candle(200)]; } });
  await assert.rejects(loadMarketSnapshot([first, second], query, "binance"), /binance market data unavailable/);
  await assert.rejects(fetchPublishedCandles([first, second], "binance", query), /blocked/);
  await assert.rejects(fetchPublishedCandles([first, second], null, query), /exchange is unknown/);
  await assert.rejects(fetchPublishedCandles([first, second], undefined, query), /exchange is unknown/);
  assert.equal(alternateCalls, 0);
  assert.deepEqual(await fetchPublishedCandles([first, second], "bybit", query), [candle(200)]);
});

test("caller cancellation ends selection without trying another source", async () => {
  const abort = new AbortController();
  let alternateCalls = 0;
  const first = source("binance", 100, { fetchTicker24h: async () => { abort.abort(new Error("navigated away")); throw new Error("cancelled"); } });
  const second = source("bybit", 200, { fetchKlines: async () => { alternateCalls++; return [candle(200)]; } });
  await assert.rejects(loadMarketSnapshot([first, second], { ...query, signal: abort.signal }), /navigated away/);
  assert.equal(alternateCalls, 0);
});

test("scanner batch metadata is reused only for its matching named source", async () => {
  let tickerReads = 0;
  const first = source("binance", 100, { fetchKlines: async () => [], fetchTicker24h: async () => { tickerReads++; return ticker(100); } });
  const second = source("bybit", 200, { fetchTicker24h: async () => { tickerReads++; return ticker(200); } });
  const batch = new Map([ [first.marketData, new Map([["BTCUSDT", ticker(100)]])], [second.marketData, new Map([["BTCUSDT", ticker(200)]])] ]);
  const result = await loadMarketSnapshot([first, second], query, undefined, batch);
  assert.equal(tickerReads, 0);
  assert.equal(result.exchange, "bybit");
  assert.equal(result.ticker.lastPrice, 200);
});

test("an unnamed single-provider port retains its individual ticker fallback after a failed batch", async () => {
  let batchReads = 0;
  let individualReads = 0;
  const unnamed: MarketDataSource = { ...source("binance", 100, {
    fetchTickers24h: async () => { batchReads++; throw new Error("partial batch unavailable"); },
    fetchTicker24h: async () => { individualReads++; return ticker(100); },
  }), exchange: null };
  const batches = createTickerBatches([unnamed], [query.symbol]);
  const first = await loadMarketSnapshot([unnamed], query, undefined, batches);
  const next = await loadMarketSnapshot([unnamed], query, undefined, batches);
  assert.equal(first.exchange, null);
  assert.equal(next.ticker.lastPrice, 100);
  assert.equal(batchReads, 1);
  assert.equal(individualReads, 2);
});

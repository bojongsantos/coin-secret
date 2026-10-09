import test from "node:test";
import assert from "node:assert/strict";
import { createFailoverMarketData } from "@/core/application/market-data/failover";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import type { Candle, MarketTicker } from "@/core/domain/models";
import { fetchTickers24h } from "@/infrastructure/market-data/binance-client";
import { fetchBybitTickers24h } from "@/infrastructure/market-data/bybit-client";

function candle(time: number): Candle {
  return { time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}

function ticker(symbol: string, lastPrice: number): MarketTicker {
  return {
    symbol,
    lastPrice,
    priceChange: 0,
    priceChangePercent: 0,
    highPrice: lastPrice,
    lowPrice: lastPrice,
    quoteVolume: 0,
    volume: 0,
  };
}

/** Records how often each operation ran so bench behaviour is observable. */
function stubProvider(
  name: string,
  behaviour: { failing: boolean },
  calls: string[],
): MarketDataPort {
  const guard = async <T>(operation: string, value: T): Promise<T> => {
    calls.push(`${name}:${operation}`);
    if (behaviour.failing) throw new Error(`${name} is down`);
    return value;
  };
  return {
    fetchKlines: () => guard("klines", [candle(1)]),
    fetchTicker24h: (symbol) => guard("ticker", ticker(symbol, name === "primary" ? 100 : 200)),
    fetchTickers24h: () => guard("tickers", [ticker("BTCUSDT", 100)]),
  };
}

test("failover serves the primary provider while it is healthy", async () => {
  const calls: string[] = [];
  const primary = stubProvider("primary", { failing: false }, calls);
  const secondary = stubProvider("secondary", { failing: false }, calls);
  const provider = createFailoverMarketData([primary, secondary]);

  const result = await provider.fetchTicker24h("BTCUSDT");

  assert.equal(result.lastPrice, 100);
  assert.deepEqual(calls, ["primary:ticker"]);
});

test("failover switches to the next provider when the primary fails", async () => {
  const calls: string[] = [];
  const primaryState = { failing: true };
  const provider = createFailoverMarketData([
    stubProvider("primary", primaryState, calls),
    stubProvider("secondary", { failing: false }, calls),
  ]);

  const result = await provider.fetchTicker24h("BTCUSDT");

  assert.equal(result.lastPrice, 200);
  assert.deepEqual(calls, ["primary:ticker", "secondary:ticker"]);
});

test("a failed provider is benched, then restored after the cooldown", async () => {
  const calls: string[] = [];
  let clock = 0;
  const primaryState = { failing: true };
  const provider = createFailoverMarketData(
    [
      stubProvider("primary", primaryState, calls),
      stubProvider("secondary", { failing: false }, calls),
    ],
    { cooldownMs: 1_000, now: () => clock },
  );

  await provider.fetchTicker24h("BTCUSDT");
  calls.length = 0;

  // Still inside the cooldown: the benched primary is not retried first.
  await provider.fetchTicker24h("BTCUSDT");
  assert.deepEqual(calls, ["secondary:ticker"]);

  // Cooldown elapsed and the primary recovered: priority returns to it.
  primaryState.failing = false;
  clock = 2_000;
  calls.length = 0;
  const restored = await provider.fetchTicker24h("BTCUSDT");
  assert.equal(restored.lastPrice, 100);
  assert.deepEqual(calls, ["primary:ticker"]);
});

test("a caller abort propagates instead of burning the fallback provider", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  const provider = createFailoverMarketData([
    {
      fetchKlines: async () => {
        calls.push("primary:klines");
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
      fetchTicker24h: async () => ticker("BTCUSDT", 1),
      fetchTickers24h: async () => [],
    },
    stubProvider("secondary", { failing: false }, calls),
  ]);

  await assert.rejects(
    () => provider.fetchKlines({ symbol: "BTCUSDT", timeframe: "15m", limit: 10, signal: controller.signal }),
    /Aborted/,
  );
  assert.deepEqual(calls, ["primary:klines"]);
});

test("the error surfaces when every provider fails", async () => {
  const calls: string[] = [];
  const provider = createFailoverMarketData([
    stubProvider("primary", { failing: true }, calls),
    stubProvider("secondary", { failing: true }, calls),
  ]);

  await assert.rejects(() => provider.fetchTickers24h(["BTCUSDT"]), /secondary is down/);
  assert.deepEqual(calls, ["primary:tickers", "secondary:tickers"]);
});

test("batch ticker cancellation reaches the provider and prevents a fallback after the caller deadline", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const provider = createFailoverMarketData([
    {
      fetchKlines: async () => [],
      fetchTicker24h: async (symbol) => ticker(symbol, 100),
      fetchTickers24h: async (_, signal) => {
        assert.equal(signal, controller.signal);
        calls.push("primary:tickers");
        controller.abort(new DOMException("Scan deadline", "TimeoutError"));
        throw controller.signal.reason;
      },
    },
    stubProvider("secondary", { failing: false }, calls),
  ]);
  await assert.rejects(provider.fetchTickers24h(["BTCUSDT"], controller.signal), /Scan deadline/);
  assert.deepEqual(calls, ["primary:tickers"]);
});

test("both batch ticker adapters cancel their HTTP read without retries when the scan deadline expires", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", (_input: unknown, init?: RequestInit) => {
    calls += 1;
    return new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
  });
  for (const fetchBatch of [fetchTickers24h, fetchBybitTickers24h]) {
    const controller = new AbortController();
    const started = calls;
    const pending = fetchBatch(["BTCUSDT"], controller.signal);
    controller.abort(new DOMException("Scan deadline", "TimeoutError"));
    await assert.rejects(pending, /Scan deadline/);
    assert.equal(calls - started, 1, "a cancelled scan must not retry its ticker request");
  }
});

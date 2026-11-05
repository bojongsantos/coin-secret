import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import type { ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import { rankTopSetups, runSdScan } from "@/core/application/scanner/supply-demand-scan-service";
import { visibleSignalsFor } from "@/core/domain/analysis/signal-display";
import { planFor, resolveFeatureAccess } from "@/core/domain/access/entitlement-rules";
import { effectivePlan } from "@/core/domain/access/subscription";
import type { Candle } from "@/core/domain/models";

function candles(): Candle[] {
  let price = 100;
  // A still-waiting order: first publication must not inherit an older fill.
  let seed = 2;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  return Array.from({ length: 274 }, (_, index) => {
    const open = price;
    price = Math.max(1, price + (index % 17 === 0 ? (next() - 0.5) * 12 : (next() - 0.5) * 1.2));
    return { time: 1_700_000_000 + index * 900, open, high: Math.max(open, price) + next() * 0.4,
      low: Math.min(open, price) - next() * 0.4, close: price, volume: 50 + next() * 50 };
  });
}

const ticker = (symbol: string, index = 0) => ({ symbol, lastPrice: 100, priceChange: 1, priceChangePercent: 1,
  highPrice: 101, lowPrice: 99, quoteVolume: 1000 + index, volume: 10 });

test("HYPE participates in the shared scan and follows each account's signal allowance", async () => {
  assert.ok(DEFAULT_WATCHLIST.includes("HYPEUSDT"), "HYPE must not depend on a paid custom-symbol request");
  assert.equal(new Set(DEFAULT_WATCHLIST).size, DEFAULT_WATCHLIST.length);
  const queried: string[] = [];
  const tape = candles();
  const scan = await runSdScan({
    fetchKlines: async ({ symbol, timeframe }) => { queried.push(`${symbol}:${timeframe}`); return tape; },
    fetchTicker24h: async (symbol) => ticker(symbol),
    fetchTickers24h: async (symbols) => symbols.map(ticker),
  }, DEFAULT_WATCHLIST);
  assert.deepEqual(queried.filter((key) => key.startsWith("HYPEUSDT:")).sort(), ["HYPEUSDT:15m", "HYPEUSDT:1H"]);
  const all = [...scan.demand, ...scan.supply];
  const hype = all.find((hit) => hit.symbol === "HYPEUSDT");
  assert.ok(hype, "a qualifying HYPE fixture reaches the shared board");
  const board = { demand: [...all.filter((hit) => hit.symbol !== "HYPEUSDT").slice(0, 3), hype], supply: [] };
  const now = new Date("2026-11-05T00:00:00Z");
  const cohorts = [
    { name: "guest", plan: "FREE", end: null, full: false },
    { name: "Free user", plan: "FREE", end: null, full: false },
    { name: "active trial", plan: "PREMIUM", end: new Date("2026-11-06T00:00:00Z"), full: true },
    { name: "expired trial", plan: "PREMIUM", end: now, full: false },
    { name: "Pro user", plan: "PREMIUM", end: new Date("2026-12-01T00:00:00Z"), full: true },
    { name: "admin with Pro", plan: "PREMIUM", end: null, full: true },
  ] as const;
  for (const cohort of cohorts) {
    const plan = planFor(effectivePlan(cohort.plan, cohort.end, now));
    const full = resolveFeatureAccess({ plan, feature: "signals" });
    assert.equal(full, cohort.full, cohort.name);
    const visible = visibleSignalsFor(board, full);
    assert.equal(visible.demandTotal, 4, cohort.name);
    assert.equal(visible.demand.some((hit) => hit.symbol === "HYPEUSDT"), cohort.full, cohort.name);
  }
});

test("all 194 default symbols retain their rankings and access filtering within the cold market budget", async (t) => {
  assert.equal(DEFAULT_WATCHLIST.length, 194);
  const tape = candles();
  const baselinePort: MarketDataPort = {
    fetchKlines: async () => tape,
    fetchTicker24h: async (symbol) => ticker(symbol),
    fetchTickers24h: async (symbols) => symbols.map(ticker),
  };
  const expected = await runSdScan(baselinePort, DEFAULT_WATCHLIST);
  assert.equal(expected.demand.length + expected.supply.length, DEFAULT_WATCHLIST.length);

  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 1000));
  let active = 0;
  let peak = 0;
  let klineCalls = 0;
  const signals = new Set<AbortSignal | undefined>();
  const market: MarketDataPort = {
    ...baselinePort,
    fetchTickers24h: async (symbols, signal) => { signals.add(signal); await pause(); return symbols.map(ticker); },
    fetchKlines: async ({ signal }) => {
      signals.add(signal);
      klineCalls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await pause();
      active -= 1;
      return tape;
    },
  };
  const store: ActiveSetupPort = {
    loadActive: async () => { await pause(); return []; },
    loadRetiredZones: async () => { await pause(); return []; },
    persist: async () => {},
  };
  const started = Date.now();
  let completed = false;
  const pending = runSdScan(market, DEFAULT_WATCHLIST, { activeSetups: store }).then((result) => { completed = true; return result; });
  for (let second = 0; second < 39 && !completed; second += 1) {
    t.mock.timers.tick(1000);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(completed, true, "the full board must complete before the 40-second market deadline");
  const result = await pending;
  assert.equal(Date.now() - started, 28_000, "metadata runs together, then a lazy batch and 16 symbols share each market wave");
  assert.equal(peak, 16);
  assert.equal(klineCalls, 388);
  assert.equal(signals.size, 1, "tickers and every candle read share the scan deadline");
  assert.ok([...signals][0] instanceof AbortSignal);
  assert.equal(result.market.length, 194);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(rankTopSetups(result, 5), rankTopSetups(expected, 5));
  assert.deepEqual(visibleSignalsFor(result, true), visibleSignalsFor(expected, true));
  assert.deepEqual(visibleSignalsFor(result, false), visibleSignalsFor(expected, false));
});

test("the shared deadline cancels stalled reads and cannot begin publishing completed market candidates after expiry", async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", (ms: number) => { assert.equal(ms, 40_000); return controller.signal; });
  const tape = candles();
  const symbols = ["GOODUSDT", ...Array.from({ length: 19 }, (_, index) => `STALL${index}USDT`)];
  const queried: string[] = [];
  let persisted: string[] = [];
  let persistenceCandidates: string[] = [];
  const market: MarketDataPort = {
    fetchTickers24h: async (input, signal) => { assert.equal(signal, controller.signal); return input.map(ticker); },
    fetchTicker24h: async (symbol) => ticker(symbol),
    fetchKlines: async ({ symbol, signal }) => {
      assert.equal(signal, controller.signal);
      queried.push(symbol);
      if (symbol === "GOODUSDT") return tape;
      return new Promise<Candle[]>((_, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }));
    },
  };
  const store: ActiveSetupPort = {
    loadActive: async (_symbols, signal) => { assert.equal(signal, controller.signal); return []; },
    loadRetiredZones: async (_symbols, signal) => { assert.equal(signal, controller.signal); return []; },
    persist: async (setups, signal) => {
      assert.equal(signal, controller.signal, "persistence must inherit the scan deadline");
      persistenceCandidates = setups.map((setup) => setup.symbol);
      signal!.throwIfAborted();
      persisted = persistenceCandidates;
    },
  };
  const pending = runSdScan(market, symbols, { activeSetups: store });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new DOMException("Timed out", "TimeoutError"));
  await assert.rejects(pending, (error) => error === controller.signal.reason);
  assert.deepEqual(persistenceCandidates, ["GOODUSDT"], "only completed market candidates can reach the writer");
  assert.deepEqual(persisted, [], "the deadline prevents even valid candidates from starting new database writes after expiry");
  assert.ok(queried.length < 21, "queued symbols do not dispatch more exchange calls after cancellation");
});

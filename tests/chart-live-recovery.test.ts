import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { KlineQuery, MarketDataPort } from "@/core/application/ports/market-data-port";
import type { Candle, Timeframe } from "@/core/domain/models";
import type { LiveAnalysis } from "@/presentation/hooks/use-live-analysis";
import * as candleOperations from "@/core/domain/market/candles";
import * as exchanges from "@/core/domain/market/exchange";
import * as timeframes from "@/core/domain/market/timeframe";
import * as recovery from "@/core/application/market-data/live-recovery";
import * as sources from "@/core/application/market-data/source-selection";
import * as failures from "@/shared/lib/read-failure";

const candle = (time: number): Candle => ({ time, open: 100, high: 103, low: 99, close: 101, volume: 10 });
const ticker = (symbol: string) => ({ symbol, lastPrice: 101, priceChange: 1, priceChangePercent: 1, highPrice: 103, lowPrice: 99, quoteVolume: 1000, volume: 10 });
const published = (symbol: string, timeframe: Timeframe = "15m", exchange: "binance" | "bybit" | null = "binance") => ({
  symbol, timeframe, exchange, direction: "long", entry: 100, target1: 110, target2: 120, stopLoss: 90,
  confidence: 80, zoneTop: 100, zoneBottom: 95, zoneBaseTime: 1_799_998_200, status: "Running",
});

test("recovery pages every missed interval beyond the exchange's 1000-row limit", async () => {
  const queries: KlineQuery[] = [];
  const marketData = { fetchKlines: async (query: KlineQuery) => {
    queries.push(query);
    const first = query.startTime! / 1000;
    return Array.from({ length: query.limit! }, (_, index) => candle(first + index * 900));
  } } as MarketDataPort;
  const rows = await recovery.recoverRecentCandles(marketData, "ZECUSDT", "15m", 900, 900 * 2501);
  assert.equal(rows.length, 2501);
  assert.deepEqual(queries.map((query) => query.limit), [1000, 1000, 501]);
  assert.equal(recovery.hasCandleGap(rows, "15m"), false);
  assert.equal(rows.at(-1)?.time, 900 * 2501);
});

test("missing recovery bars never become a supposedly complete lifecycle tape", async () => {
  const marketData = { fetchKlines: async () => [candle(900), candle(2700)] } as unknown as MarketDataPort;
  await assert.rejects(recovery.recoverRecentCandles(marketData, "ZECUSDT", "15m", 900, 2700), /missing candle/);
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await assert.rejects(recovery.recoverRecentCandles(marketData, "ZECUSDT", "15m", 900, 2700, controller.signal), /cancelled/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function hookHarness() {
  let now = 1_800_000_000_000;
  let online = true;
  let symbol = "ZECUSDT";
  let timeframe: Timeframe = "15m";
  let dirty = true;
  let cursor = 0;
  let result!: LiveAnalysis;
  let nextTimer = 0;
  let setupReads = 0;
  let nextSetup: ((signal: AbortSignal) => Promise<unknown>) | null = null;
  let plan: unknown = published(symbol);
  let failBinance = false;
  let failKlines = false;
  let failTicker = false;
  let omitRecoveryCandle = false;
  let holdKlines: ReturnType<typeof deferred<Candle[]>> | null = null;
  const slots: Array<unknown> = [];
  const effects: Array<{ run: () => (() => void) | undefined; previous?: () => void; index: number }> = [];
  const timers = new Map<number, { at: number; interval?: number; callback: () => void }>();
  const listeners = new Map<string, Set<() => void>>();
  const reads: Array<{ exchange: string; query?: KlineQuery; symbol: string }> = [];
  const engine: Array<{ symbol: string; timeframe: string; exchange: string; candles: Candle[]; setup: unknown; options: Record<string, unknown> }> = [];
  const sockets: Array<{ update: (value: { symbol: string; candle?: Candle; ticker?: ReturnType<typeof ticker> }) => void; status: (value: string) => void; stopped: boolean }> = [];
  const addEventListener = (name: string, callback: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); };
  const removeEventListener = (name: string, callback: () => void) => listeners.get(name)?.delete(callback);
  const schedule = (callback: () => void, delay: number, interval?: number) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay, interval }); return id; };
  class ClockDate extends Date {
    constructor(value?: string | number) { super(value ?? now); }
    static now() { return now; }
  }
  function provider(exchange: string): MarketDataPort {
    return {
      fetchTickers24h: async () => [],
      fetchTicker24h: async (requested) => {
        reads.push({ exchange, symbol: requested });
        if (exchange === "binance" && failBinance) throw new Error("Binance unavailable");
        if (failTicker) { failTicker = false; throw new Error("Ticker unavailable"); }
        return ticker(requested);
      },
      fetchKlines: async (query) => {
        reads.push({ exchange, query, symbol: query.symbol });
        if (holdKlines) { const held = holdKlines; holdKlines = null; return held.promise; }
        if (exchange === "binance" && failBinance) throw new Error("Binance unavailable");
        if (failKlines) throw new Error("Candle unavailable");
        const step = timeframes.TIMEFRAME_SECONDS[query.timeframe];
        if (query.startTime !== undefined) {
          const rows = Array.from({ length: query.limit! }, (_, index) => candle(query.startTime! / 1000 + index * step));
          return omitRecoveryCandle ? rows.filter((_, index) => index !== 1) : rows;
        }
        const latest = Math.floor(now / 1000 / step) * step;
        return [candle(latest - step * 2), candle(latest - step), candle(latest)];
      },
    };
  }
  const sourceList = [{ exchange: "binance", marketData: provider("binance") }, { exchange: "bybit", marketData: provider("bybit") }];
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync("src/presentation/hooks/use-live-analysis.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Date: ClockDate, Error, DOMException, AbortController,
    AbortSignal: { any: AbortSignal.any, timeout: (ms: number) => { const controller = new AbortController(); schedule(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms); return controller.signal; } },
    require: (name: string) => ({
      react: {
        useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: unknown) => { const next = typeof value === "function" ? (value as (prior: unknown) => unknown)(slots[index]) : value; if (!Object.is(slots[index], next)) { slots[index] = next; dirty = true; } }]; },
        useRef: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
        useCallback: (callback: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = callback; return slots[index]; },
        useEffect: (run: () => (() => void) | undefined, dependencies: unknown[]) => { const index = cursor++; const previous = slots[index] as { dependencies: unknown[]; cleanup?: () => void } | undefined; if (previous && dependencies.every((value, item) => Object.is(value, previous.dependencies[item]))) return; effects.push({ run, previous: previous?.cleanup, index }); slots[index] = { dependencies }; },
      },
      "@/core/application/market-data/source-selection": sources,
      "@/core/application/market-data/live-recovery": recovery,
      "@/core/application/market-data/history-loader": { HISTORY_PAGE_SIZE: 1000, fetchListingTime: async () => null, loadHistory: async () => ({ candles: [], truncated: false }) },
      "@/core/application/market-data/history-plan": { estimateRangeCandles: () => 100 },
      "@/core/domain/market/exchange": exchanges,
      "@/core/domain/market/timeframe": timeframes,
      "@/core/domain/market/candles": candleOperations,
      "@/core/domain/analysis/analysis-engine": { buildAnalysisResult: (requested: string, _base: string, _quote: string, interval: string, exchange: string, candles: Candle[], _ticker: unknown, setup: unknown, _locale: unknown, options: Record<string, unknown>) => { engine.push({ symbol: requested, timeframe: interval, exchange, candles, setup, options }); return { pair: { symbol: requested }, chartData: { candles } }; } },
      "@/infrastructure/market-data/market-data-provider": { marketDataSources: sourceList },
      "@/infrastructure/market-data/binance-stream-client": { subscribeBinanceMarket: (_symbol: string, _timeframe: string, update: (value: unknown) => void, status: (value: string) => void) => { const socket = { update, status, stopped: false }; sockets.push(socket); return () => { socket.stopped = true; }; } },
      "@/presentation/hooks/use-ui-preference": { useLocale: () => ({ locale: "en" }) },
      "@/shared/lib/read-failure": failures,
    } as Record<string, unknown>)[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
    document: { visibilityState: "visible", addEventListener, removeEventListener },
    navigator: { get onLine() { return online; } },
    window: { addEventListener, removeEventListener },
    setTimeout: (callback: () => void, delay: number) => schedule(callback, delay), clearTimeout: (id: number) => timers.delete(id),
    setInterval: (callback: () => void, delay: number) => schedule(callback, delay, delay), clearInterval: (id: number) => timers.delete(id),
    fetch: async (_url: string, options: { signal: AbortSignal }) => {
      setupReads++;
      const loader = nextSetup;
      nextSetup = null;
      if (loader) return loader(options.signal);
      options.signal.throwIfAborted();
      return Response.json({ setup: plan });
    },
  });
  function render() {
    for (let pass = 0; dirty && pass < 10; pass++) {
      dirty = false; cursor = 0;
      result = (exports.useLiveAnalysis as (symbol: string, timeframe: Timeframe, range: string) => LiveAnalysis)(symbol, timeframe, "month");
    }
    for (const effect of effects.splice(0)) { effect.previous?.(); (slots[effect.index] as { cleanup?: () => void }).cleanup = effect.run(); }
  }
  const flush = async () => { for (let item = 0; item < 30; item++) { render(); await Promise.resolve(); } render(); };
  return {
    reads, sockets, engine, timers, flush,
    view: () => result,
    setupReads: () => setupReads,
    setPlan: (value: unknown) => { plan = value; },
    setupResponse: (callback: (signal: AbortSignal) => Promise<unknown>) => { nextSetup = callback; },
    bybitOnly: () => { failBinance = true; },
    failCandles: (value = true) => { failKlines = value; },
    missRecoveryBar: (value = true) => { omitRecoveryCandle = value; },
    failNextTicker: () => { failTicker = true; },
    deferCandles: () => { const pending = deferred<Candle[]>(); holdKlines = pending; return pending; },
    switchTo: (nextSymbol: string, nextTimeframe: Timeframe = "15m") => { symbol = nextSymbol; timeframe = nextTimeframe; dirty = true; render(); },
    event: (name: string) => { if (name === "offline") online = false; if (name === "online") online = true; for (const callback of listeners.get(name) ?? []) callback(); },
    elapse: (ms: number) => { now += ms; for (const timer of timers.values()) timer.at += ms; },
    advance: async (ms: number) => { await flush(); const end = now + ms; while (true) { const due = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; const [id, value] = due; now = value.at; if (value.interval) value.at += value.interval; else timers.delete(id); value.callback(); await flush(); } now = end; await flush(); },
    stop: () => { for (const slot of slots) (slot as { cleanup?: () => void })?.cleanup?.(); },
  };
}

test("published metadata clears immediately on a coin switch and ignores late prior responses", async () => {
  const h = hookHarness(); h.setPlan(published("ZECUSDT", "1H")); await h.flush();
  assert.equal(h.view().publishedTimeframe, "1H");
  const late = deferred<unknown>(); h.setupResponse(() => late.promise);
  h.switchTo("BTCUSDT");
  assert.equal(h.view().publishedTimeframe, null);
  assert.equal(h.view().analysis, null);
  await h.flush();
  h.setPlan(published("ETHUSDT")); h.switchTo("ETHUSDT"); await h.flush();
  late.resolve(Response.json({ setup: published("BTCUSDT", "1H") })); await h.flush();
  assert.equal(h.view().publishedTimeframe, "15m");
  assert.equal(h.view().analysis?.pair.symbol, "ETHUSDT");
  assert.equal(h.view().setupState, "published");
  assert.equal(h.sockets.filter((socket) => !socket.stopped).length, 1);
  h.stop();
});

test("a published Bybit venue uses Bybit for every read and never subscribes Binance", async () => {
  const h = hookHarness(); h.setPlan(published("ZECUSDT", "15m", "bybit")); await h.flush();
  assert.equal(h.view().exchange, "bybit");
  assert.equal(h.view().connectionState, "polling");
  assert.equal(h.sockets.length, 0);
  await h.advance(4000);
  assert.ok(h.reads.length > 2);
  assert.ok(h.reads.every((read) => read.exchange === "bybit"));
  assert.equal(h.engine.at(-1)?.exchange, "Bybit");
  h.stop();
});

test("failed or malformed plan reads are visible and cannot silently substitute local plans", async () => {
  for (const response of [new Response("{}", { status: 503 }), Response.json({ setup: published("OTHERUSDT") }), Response.json({ setup: { ...published("ZECUSDT"), entry: "100" } }), Response.json({ setup: { ...published("ZECUSDT"), timeframe: "constructor" } })]) {
    const h = hookHarness(); h.setupResponse(async () => response); await h.flush();
    assert.equal(h.view().setupState, "unavailable");
    assert.ok(h.view().setupError);
    assert.equal(h.engine.at(-1)?.options.publishedOnly, true);
    assert.equal(h.engine.at(-1)?.setup, null);
    h.stop();
  }
});

test("unknown legacy provenance preserves the stored plan without lifecycle replay", async () => {
  const h = hookHarness(); h.setPlan(published("ZECUSDT", "15m", null)); await h.flush();
  assert.equal(h.view().setupState, "legacy");
  assert.equal(h.engine.at(-1)?.options.evaluateLifecycle, false);
  assert.equal(h.engine.at(-1)?.options.publishedOnly, true);
  assert.equal((h.engine.at(-1)?.setup as { status: string }).status, "Running");
  h.stop();
});

test("an open socket is not live until actual current data arrives", async () => {
  const h = hookHarness(); await h.flush();
  const firstUpdate = h.view().lastUpdated;
  h.sockets[0].status("live"); await h.flush();
  assert.equal(h.view().connectionState, "polling");
  await h.advance(1000);
  h.sockets[0].update({ symbol: "ZECUSDT", ticker: ticker("ZECUSDT") }); await h.flush();
  assert.equal(h.view().connectionState, "live");
  assert.notEqual(h.view().lastUpdated, firstUpdate);
  h.stop();
});

test("offline recovery restores every missed candle before replay and exposes partial failure", async () => {
  const h = hookHarness(); await h.flush();
  const original = h.engine.at(-1)!.candles.at(-1)!.time;
  h.event("offline"); await h.advance(900 * 1000 * 6);
  assert.equal(h.view().connectionState, "delayed");
  h.missRecoveryBar(); h.event("online"); await h.flush();
  assert.equal(h.view().connectionState, "delayed");
  assert.ok(h.view().error);
  assert.equal(h.engine.at(-1)!.candles.at(-1)!.time, original);
  h.missRecoveryBar(false); h.view().retry(); await h.flush(); await h.advance(400);
  assert.equal(h.view().error, null);
  const recovered = h.engine.at(-1)!;
  assert.equal(recovered.candles.length, 9);
  assert.equal(recovery.hasCandleGap(recovered.candles, "15m"), false);
  assert.equal(recovered.options.evaluateLifecycle, true);
  h.stop();
});

test("polling retains the last successful timestamp when ticker fails and drains its pending candle sibling", async () => {
  const h = hookHarness(); await h.flush();
  const last = h.view().lastUpdated;
  h.failNextTicker(); const pending = h.deferCandles();
  await h.advance(4000);
  const count = h.reads.length;
  h.event("online"); h.view().retry(); await h.flush();
  assert.equal(h.reads.length, count);
  assert.equal(h.view().lastUpdated, last);
  pending.resolve([candle(h.engine.at(-1)!.candles.at(-1)!.time)]); await h.flush();
  assert.equal(h.view().connectionState, "delayed");
  h.view().retry(); await h.flush();
  assert.equal(h.view().error, null);
  h.stop();
});

test("successful absent and mismatched plans have distinct explicit states", async () => {
  const missing = hookHarness(); missing.setPlan(null); await missing.flush();
  assert.equal(missing.view().setupState, "missing");
  assert.equal(missing.engine.at(-1)?.options.publishedOnly, false);
  missing.stop();
  const mismatch = hookHarness(); mismatch.setPlan(published("ZECUSDT", "1H")); await mismatch.flush();
  assert.equal(mismatch.view().setupState, "mismatched");
  assert.equal(mismatch.view().publishedTimeframe, "1H");
  assert.equal(mismatch.engine.at(-1)?.options.publishedOnly, true);
  mismatch.stop();
});

test("timeframe switches abort the prior plan read and do not keep its late metadata", async () => {
  const h = hookHarness();
  const late = deferred<unknown>(); let previousSignal!: AbortSignal;
  h.setupResponse((signal) => { previousSignal = signal; return late.promise; }); await h.flush();
  h.setPlan(published("ZECUSDT", "1H")); h.switchTo("ZECUSDT", "1H"); await h.flush();
  assert.equal(previousSignal.aborted, true);
  late.resolve(Response.json({ setup: published("ZECUSDT", "15m") })); await h.flush();
  assert.equal(h.view().publishedTimeframe, "1H");
  assert.equal(h.view().analysis?.pair.symbol, "ZECUSDT");
  assert.equal(h.engine.at(-1)?.timeframe, "1H");
  h.stop();
});

test("a stalled plan request times out, is single-flight, and recovers without hiding its failure", async () => {
  const h = hookHarness();
  h.setupResponse((signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
  await h.flush(); h.view().retry(); h.event("online"); await h.flush();
  assert.equal(h.setupReads(), 1);
  await h.advance(10_000);
  assert.equal(h.view().setupState, "unavailable");
  assert.match(h.view().setupError!, /timed out/);
  assert.equal(h.view().analysis?.pair.symbol, "ZECUSDT");
  await h.advance(2000);
  assert.equal(h.view().setupState, "published");
  assert.equal(h.view().setupError, null);
  h.stop();
});

test("plan rate limiting honors Retry-After even through repeated manual retries", async () => {
  const h = hookHarness();
  h.setupResponse(async () => new Response("{}", { status: 429, headers: { "Retry-After": "10" } }));
  await h.flush();
  h.view().retry(); h.view().retry(); await h.flush();
  assert.equal(h.setupReads(), 1);
  await h.advance(9000);
  assert.equal(h.setupReads(), 1);
  await h.advance(1000);
  assert.equal(h.setupReads(), 2);
  assert.equal(h.view().setupState, "published");
  h.stop();
});

test("REST repairs the previous closed candle after its final websocket frame was missed", async () => {
  const h = hookHarness(); await h.flush();
  const priorTime = h.engine.at(-1)!.candles.at(-1)!.time;
  h.elapse(900_000);
  h.sockets[0].update({ symbol: "ZECUSDT", candle: candle(priorTime + 900) }); await h.flush();
  const pending = h.deferCandles(); h.view().retry(); await h.flush();
  const read = h.reads.filter((row) => row.query).at(-1)!;
  assert.equal(read.query?.startTime, priorTime * 1000);
  h.sockets[0].update({ symbol: "ZECUSDT", candle: candle(priorTime + 1800) }); await h.flush();
  pending.resolve([{ ...candle(priorTime), high: 111 }, candle(priorTime + 900)]);
  await h.flush(); await h.advance(400);
  assert.equal(h.engine.at(-1)!.candles.find((row) => row.time === priorTime)?.high, 111);
  assert.equal(h.engine.at(-1)!.candles.at(-1)!.time, priorTime + 900);
  assert.equal(h.view().error, null);
  h.stop();
});

test("unknown source may choose a coherent Bybit chart, but a known Binance plan never changes feeds", async () => {
  const open = hookHarness(); open.setPlan(null); open.bybitOnly(); await open.flush();
  assert.equal(open.view().exchange, "bybit");
  assert.equal(open.view().setupState, "missing");
  assert.equal(open.sockets.length, 0);
  assert.equal(open.engine.at(-1)?.exchange, "Bybit");
  open.stop();
  const pinned = hookHarness(); pinned.bybitOnly(); await pinned.flush();
  assert.equal(pinned.view().analysis, null);
  assert.equal(pinned.view().lastUpdated, null);
  assert.equal(pinned.view().connectionState, "delayed");
  assert.ok(pinned.view().error);
  assert.ok(pinned.reads.every((read) => read.exchange === "binance"));
  pinned.stop();
});

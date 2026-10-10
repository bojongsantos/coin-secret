import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { translate } from "@/shared/i18n/messages";
import * as failures from "@/shared/lib/read-failure";
import * as sourceSelection from "@/core/application/market-data/source-selection";
import * as exchanges from "@/core/domain/market/exchange";
import * as timeframes from "@/core/domain/market/timeframe";

type Node = { type: unknown; props: Record<string, unknown> };
function jsx(type: unknown, props: Record<string, unknown>): unknown {
  return typeof type === "function" ? type(props) : { type, props };
}
function textOf(node: unknown): string {
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (!node || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  return textOf((node as Node).props?.children);
}
function load(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, Date, Error, DOMException, AbortSignal, AbortController,
    require: (name: string) => dependencies[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
    ...globals,
  });
  return exports;
}

function ui() {
  const deps: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/link": { default: "link" },
    "lucide-react": { CandlestickChart: "icon", Loader2: "loader", Lock: "lock", RefreshCw: "refresh" },
    "@/presentation/hooks/use-translate": { useT: () => ({ t: (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars), locale: "en" }) },
    "@/presentation/ui/coin-icon": { CoinIcon: "coin" },
    "@/presentation/ui/status-icon": { StatusIcon: "status-icon" },
    "@/shared/i18n/messages": { statusMessageKey: () => undefined },
    "@/shared/lib/format": { formatCompact: String, formatPrice: String, priceDecimals: () => 2 },
  };
  deps["@/presentation/ui/data-status"] = load("src/presentation/ui/data-status.tsx", deps);
  return deps;
}

test("failed Signals is unavailable rather than zero valid setups", () => {
  const api = load("src/presentation/features/signals/signals-board.tsx", ui());
  const props = { demand: [], supply: [], loading: false, error: "Check your connection.", onRefresh() {} };
  const failed = textOf(api.SignalsBoard(props));
  assert.match(failed, /Data temporarily unavailable/);
  assert.match(failed, /Try again/);
  assert.doesNotMatch(failed, /0 setups|No zone on this side/);
  const empty = textOf(api.SignalsBoard({ ...props, error: null }));
  assert.match(empty, /0 setups/);
  assert.match(empty, /No zone on this side/);
});

test("a partial scan does not declare an empty side complete", () => {
  const api = load("src/presentation/features/signals/signals-board.tsx", ui());
  const rendered = textOf(api.SignalsBoard({ demand: [], supply: [], loading: false, error: null, failedCount: 4, onRefresh() {} }));
  assert.match(rendered, /Data temporarily unavailable/);
  assert.doesNotMatch(rendered, /0 setups|No zone on this side/);
});

test("Top Setups distinguishes failed fetching from a successful empty scan", () => {
  const api = load("src/presentation/features/dashboard/top-setups-strip.tsx", ui());
  const props = { setups: [], loading: false, activeSymbol: null, onSelect() {} };
  assert.doesNotMatch(textOf(api.TopSetupsStrip({ ...props, error: "Check your connection.", onRetry() {} })), /No setup/i);
  assert.match(textOf(api.TopSetupsStrip(props)), /No setup/i);
});

test("a retained public snapshot explicitly shows stale and its update time", () => {
  const api = load("src/presentation/ui/data-status.tsx", ui());
  const rendered = textOf(api.DataStatus({ error: "Connection unavailable.", stale: true, lastUpdated: "2026-10-10T01:00:00Z", onRetry() {} }));
  assert.match(rendered, /Showing the last available data; not yet updated/);
  assert.match(rendered, /Last successful update/);
  assert.match(rendered, /Try again/);
});

function chartHarness(options: { available?: boolean; deferKlines?: boolean } = {}) {
  let online = true;
  let available = options.available ?? false;
  let deferKlines = options.deferKlines ?? false;
  let failTicker = false;
  let resolveKlines: ((candles: unknown) => void) | undefined;
  let tickerReads = 0;
  let klineReads = 0;
  let subscriptions = 0;
  const effects: Array<() => (() => void) | undefined> = [];
  const listeners = new Map<string, () => void>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  const timer = (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; };
  const candles = [{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 10 }];
  const api = load("src/presentation/hooks/use-live-analysis.ts", {
    react: {
      useState: (initial: unknown) => [initial, () => undefined],
      useRef: (initial: unknown) => ({ current: initial }),
      useCallback: (callback: unknown) => callback,
      useEffect: (effect: () => (() => void) | undefined) => effects.push(effect),
    },
    "@/presentation/hooks/use-ui-preference": { useLocale: () => ({ locale: "en" }) },
    "@/shared/lib/read-failure": failures,
    "@/core/application/market-data/history-loader": { HISTORY_PAGE_SIZE: 1000, fetchListingTime: async () => 1, loadHistory: async () => ({ candles, truncated: false }) },
    "@/core/application/market-data/history-plan": { estimateRangeCandles: () => 100 },
    "@/core/domain/analysis/analysis-engine": { buildAnalysisResult: () => ({ chartData: {} }) },
    "@/core/domain/market/candles": { applyRecentCandles: (_prior: unknown, latest: unknown) => latest, olderThan: () => [], upsertLatestCandle: (prior: unknown) => prior },
    "@/core/domain/market/exchange": exchanges,
    "@/core/domain/market/timeframe": timeframes,
    "@/core/application/market-data/source-selection": sourceSelection,
    "@/core/application/market-data/live-recovery": {
      hasCandleGap: () => false,
      recoverRecentCandles: (provider: { fetchKlines: (query: unknown) => Promise<unknown> }, symbol: string, timeframe: string, _last: number, _now: number, signal: AbortSignal) => provider.fetchKlines({ symbol, timeframe, limit: 2, signal }),
    },
    "@/infrastructure/market-data/market-data-provider": { marketDataSources: [{ exchange: "binance", marketData: {
      fetchTicker24h: async () => {
        tickerReads++;
        if (failTicker) { failTicker = false; throw new TypeError("Load failed"); }
        if (!available) throw new TypeError("Load failed");
        return { price: 2 };
      },
      fetchKlines: async () => {
        klineReads++;
        if (deferKlines) {
          deferKlines = false;
          return new Promise((resolve) => { resolveKlines = resolve; });
        }
        if (!available) throw new TypeError("Load failed");
        return candles;
      },
    } }] },
    "@/infrastructure/market-data/binance-stream-client": { subscribeBinanceMarket: () => { subscriptions++; return () => undefined; } },
  }, {
    fetch: async () => Response.json({ setup: null }),
    window: {
      setInterval: timer, clearInterval: (id: number) => timers.delete(id),
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    },
    document: {
      visibilityState: "visible",
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    },
    navigator: { get onLine() { return online; } },
    setTimeout: timer, clearTimeout: (id: number) => timers.delete(id),
    setInterval: timer, clearInterval: (id: number) => timers.delete(id),
  });
  const cleanups: Array<() => void> = [];
  return {
    api,
    mount: () => effects.forEach((effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }),
    reconnect: () => { online = true; available = true; listeners.get("online")?.(); },
    reads: () => tickerReads,
    klineReads: () => klineReads,
    deferNextKlines: () => { deferKlines = true; },
    failNextTicker: () => { failTicker = true; },
    releaseKlines: () => { resolveKlines?.(candles); resolveKlines = undefined; },
    runTimer: (delay: number) => {
      const scheduled = [...timers.values()].find((value) => value.delay === delay);
      scheduled?.callback();
      return Boolean(scheduled);
    },
    subscriptions: () => subscriptions,
    cleanup: () => cleanups.forEach((cleanup) => cleanup()),
    timers,
  };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test("a dashboard without a selected setup never starts the arbitrary BTC chart", async () => {
  const harness = chartHarness();
  const view = harness.api.useLiveAnalysis("BTCUSDT", "15m", "month", false) as { analysis: unknown; loading: boolean };
  harness.mount();
  await flush();
  assert.equal(harness.reads(), 0);
  assert.equal(view.analysis, null);
  assert.equal(view.loading, false);
});

test("an initially failed chart recovers on reconnect and cancels its recovery work on unmount", async () => {
  const harness = chartHarness();
  harness.api.useLiveAnalysis("ZECUSDT", "15m", "month");
  harness.mount();
  await flush();
  assert.equal(harness.reads(), 1);
  assert.equal(harness.subscriptions(), 0);
  harness.reconnect();
  harness.reconnect();
  await flush();
  assert.equal(harness.reads(), 2, "concurrent reconnect events share initial loading");
  assert.equal(harness.subscriptions(), 1);
  harness.cleanup();
  assert.equal(harness.timers.size, 0);
});

test("chart startup stays single-flight while a rejected ticker's candle request is pending", async () => {
  const harness = chartHarness({ deferKlines: true });
  harness.api.useLiveAnalysis("ZECUSDT", "15m", "month");
  harness.mount();
  await flush();
  assert.equal(harness.reads(), 1);
  assert.equal(harness.klineReads(), 1);
  harness.reconnect();
  harness.reconnect();
  await flush();
  assert.equal(harness.klineReads(), 1, "Reconnect must not duplicate the still-pending candle request");
  assert.equal(harness.runTimer(2_000), false, "Retry waits for both startup requests to settle");
  harness.releaseKlines();
  await flush();
  assert.equal(harness.runTimer(2_000), true);
  await flush();
  assert.equal(harness.reads(), 2);
  assert.equal(harness.klineReads(), 2);
  assert.equal(harness.subscriptions(), 1);
  harness.cleanup();
});

test("chart polling waits for the pending candle sibling after a ticker failure", async () => {
  const harness = chartHarness({ available: true });
  harness.api.useLiveAnalysis("ZECUSDT", "15m", "month");
  harness.mount();
  await flush();
  assert.equal(harness.subscriptions(), 1);
  harness.failNextTicker();
  harness.deferNextKlines();
  assert.equal(harness.runTimer(4_000), true);
  await flush();
  assert.equal(harness.klineReads(), 2);
  harness.reconnect();
  assert.equal(harness.runTimer(4_000), true);
  await flush();
  assert.equal(harness.klineReads(), 2, "Resume and polling must share the pending request pair");
  harness.releaseKlines();
  await flush();
  assert.equal(harness.runTimer(4_000), true);
  await flush();
  assert.equal(harness.reads(), 3);
  assert.equal(harness.klineReads(), 3);
  harness.cleanup();
});

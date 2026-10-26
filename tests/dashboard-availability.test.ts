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
import { marketFallback } from "@/config/market-fallbacks";

type Node = { type: unknown; props: Record<string, unknown> };
function jsx(type: unknown, props: Record<string, unknown>): unknown {
  return typeof type === "function" ? type(props) : { type, props };
}
function textOf(node: unknown, visibleOnly = false): string {
  if (Array.isArray(node)) return node.map((child) => textOf(child, visibleOnly)).join(" ");
  if (!node || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  const props = (node as Node).props;
  if (visibleOnly && (props?.["aria-hidden"] || String(props?.className).split(" ").includes("sr-only"))) return "";
  return textOf(props?.children, visibleOnly);
}
function nodesOf(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodesOf);
  if (!node || typeof node !== "object") return [];
  return [node as Node, ...nodesOf((node as Node).props?.children)];
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
    "next/navigation": { usePathname: () => "/dashboard" },
    "@/presentation/features/access/plan-provider": { usePlan: () => ({ authenticated: false }) },
    "lucide-react": { CandlestickChart: "icon", Clock3: "clock", Loader2: "loader", Lock: "lock", RefreshCw: "refresh" },
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

test("locked dashboard rows send guests to sign in and authenticated Free users to Pro pricing", () => {
  for (const authenticated of [false, true]) {
    const api = load("src/presentation/features/signals/signals-board.tsx", {
      ...ui(), "@/presentation/features/access/plan-provider": { usePlan: () => ({ authenticated }) },
    });
    const rendered = api.SignalsBoard({ demand: [], supply: [], demandTotal: 4, loading: false, error: null, onRefresh() {} });
    const action = nodesOf(rendered).find(({ type }) => type === "link");
    assert.equal(action?.props.href, authenticated ? "/pricing" : "/login?next=%2Fdashboard");
    assert.match(textOf(action), authenticated ? /Unlock Pro/ : /Sign in/);
  }
});

test("Top Setups distinguishes failed fetching from a successful empty scan", () => {
  const api = load("src/presentation/features/dashboard/top-setups-strip.tsx", ui());
  const props = { setups: [], loading: false, activeSymbol: null, onSelect() {} };
  assert.doesNotMatch(textOf(api.TopSetupsStrip({ ...props, error: "Check your connection.", onRetry() {} })), /No setup/i);
  assert.match(textOf(api.TopSetupsStrip(props)), /No setup/i);
});

test("healthy snapshots stay quiet; idle retained snapshots expose stale and retry without a warning banner", () => {
  const api = load("src/presentation/ui/data-status.tsx", ui());
  assert.equal(api.DataStatus({ lastUpdated: "2026-10-10T01:00:00Z" }), null);
  let retries = 0;
  const rendered = api.DataStatus({ error: "Connection unavailable.", stale: true, lastUpdated: "2026-10-10T01:00:00Z", onRetry() { retries++; } });
  assert.match(textOf(rendered), /Showing the last available data; not yet updated.*Connection unavailable/);
  assert.equal(textOf(rendered, true).trim(), "");
  assert.equal(nodesOf(rendered).find(({ props }) => props.role === "status")?.props.title, translate("en", "data.stale"));
  assert.ok(nodesOf(rendered).some(({ type }) => type === "clock"));
  assert.ok(nodesOf(rendered).every(({ props }) => !String(props.className).includes("warning")));
  const retry = nodesOf(rendered).find(({ type }) => type === "button")!;
  assert.equal(retry.props["aria-label"], "Try again");
  (retry.props.onClick as () => void)();
  assert.equal(retries, 1);
});

test("refreshing status is a compact accessible spinner without warning prose or duplicate retry", () => {
  const api = load("src/presentation/ui/data-status.tsx", ui());
  for (const props of [{ loading: true }, { loading: true, stale: true, error: "Connection unavailable.", onRetry() {} }]) {
    const rendered = api.DataStatus(props);
    const nodes = nodesOf(rendered);
    assert.equal(textOf(rendered, true).trim(), "");
    assert.match(textOf(rendered), /Loading/);
    assert.equal(nodes.find(({ props }) => props.role === "status")?.props.title, "Loading…");
    assert.match(String(nodes.find(({ type }) => type === "loader")?.props.className), /size-4 animate-spin motion-reduce:animate-none/);
    assert.ok(nodes.every(({ props }) => !String(props.className).includes("warning")));
    assert.ok(nodes.every(({ type }) => type !== "button"));
  }
});

test("unavailable data still exposes its visible error and a working retry", () => {
  const api = load("src/presentation/ui/data-status.tsx", ui());
  let retries = 0;
  const rendered = api.DataStatus({ error: "Connection unavailable.", onRetry() { retries++; } });
  assert.match(textOf(rendered, true), /Data temporarily unavailable.*Connection unavailable.*Try again/);
  assert.ok(nodesOf(rendered).some(({ props }) => String(props.className).includes("text-warning")));
  (nodesOf(rendered).find(({ type }) => type === "button")!.props.onClick as () => void)();
  assert.equal(retries, 1);
});

test("Signals, Top Setups and Market Overview preserve their data during refresh without visible stale prose", () => {
  const deps = {
    ...ui(),
    "@/core/domain/analysis/conviction": { buildConviction: () => undefined },
    "@/presentation/features/dashboard/panel": { Panel: ({ children }: { children: unknown }) => jsx("section", { children }) },
    "@/presentation/widgets/right-rail/conviction-score-card": { ConvictionScoreCard: "conviction" },
    "@/presentation/widgets/right-rail/market-context-card": { MarketContextCard: ({ data }: { data: { marketCap: string } }) => jsx("context", { children: data.marketCap }) },
    "@/presentation/widgets/right-rail/market-sentiment-card": { MarketSentimentCard: ({ data }: { data: { value: number } }) => jsx("sentiment", { children: data.value }) },
    "@/config/market-fallbacks": {},
  };
  const hit = { symbol: "BTCUSDT", base: "BTC", entry: 100, direction: "long", confidence: 80, exchange: "binance", volume24h: 1_000_000, change24h: 1, timeframe: "15m", status: "active" };
  const base = { loading: true, stale: true, lastUpdated: "2026-10-10T01:00:00Z" };
  const views = [
    load("src/presentation/features/signals/signals-board.tsx", deps).SignalsBoard({ ...base, demand: [hit], supply: [], error: null, onRefresh() {} }),
    load("src/presentation/features/dashboard/top-setups-strip.tsx", deps).TopSetupsStrip({ ...base, setups: [{ hit }], activeSymbol: null, onSelect() {} }),
    load("src/presentation/features/dashboard/market-overview.tsx", deps).MarketOverview({ ...base, context: { marketCap: "$100T" }, sentiment: { value: 65 } }),
  ];
  views.forEach((rendered, index) => {
    assert.match(textOf(rendered, true), index === 2 ? /\$100T.*65|65.*\$100T/ : /BTC/);
    assert.doesNotMatch(textOf(rendered, true), /Showing the last available data|Loading|Try again/);
    assert.match(textOf(rendered), /Showing the last available data/);
    assert.ok(nodesOf(rendered).some(({ type }) => type === "loader"));
  });
});

test("market loading and failure do not hide independent chart confidence or invent market values", () => {
  const api = load("src/presentation/features/dashboard/market-overview.tsx", {
    ...ui(),
    "@/core/domain/analysis/conviction": { buildConviction: ({ confidence }: { confidence: number }) => ({ score: confidence }) },
    "@/presentation/features/dashboard/panel": { Panel: ({ children }: { children: unknown }) => jsx("section", { children }) },
    "@/presentation/widgets/right-rail/conviction-score-card": {
      ConvictionScoreCard: ({ data }: { data: { score: number } }) => jsx("confidence", { children: data.score ? `Confidence ${data.score}` : "Waiting for chart data" }),
    },
    "@/presentation/widgets/right-rail/market-context-card": { MarketContextCard: () => { throw new Error("Missing market context must not be fabricated"); } },
    "@/presentation/widgets/right-rail/market-sentiment-card": { MarketSentimentCard: () => { throw new Error("Missing sentiment must not be fabricated"); } },
    "@/config/market-fallbacks": {},
  });
  const props = { context: null, sentiment: null, analysis: { pattern: { confidence: 83 } } };
  const pending = api.MarketOverview({ ...props, loading: true });
  assert.match(textOf(pending, true), /Confidence 83/);
  assert.equal(nodesOf(pending).filter(({ props }) => String(props.className).includes("animate-pulse")).length, 2);
  assert.doesNotMatch(textOf(pending, true), /Data temporarily unavailable/);

  let retries = 0;
  const failed = api.MarketOverview({ ...props, loading: false, error: "Connection unavailable.", onRefresh() { retries++; } });
  assert.match(textOf(failed, true), /Data temporarily unavailable.*Confidence 83/);
  assert.equal(nodesOf(failed).filter(({ props }) => String(props.className).includes("animate-pulse")).length, 0);
  (nodesOf(failed).find(({ type }) => type === "button")!.props.onClick as () => void)();
  assert.equal(retries, 1);

  const retrying = api.MarketOverview({ ...props, loading: true, error: "Connection unavailable." });
  assert.match(textOf(retrying, true), /Data temporarily unavailable.*Confidence 83/);
  assert.equal(nodesOf(retrying).filter(({ props }) => String(props.className).includes("animate-pulse")).length, 0);
  assert.ok(nodesOf(retrying).some(({ type }) => type === "loader"));

  const waiting = api.MarketOverview({ ...props, analysis: null, loading: true });
  assert.match(textOf(waiting, true), /Waiting for chart data/);
  assert.doesNotMatch(textOf(waiting, true), /Confidence \d/);
});

test("market requests abort transport after twelve seconds and still honor caller cancellation", async () => {
  let read!: (force: boolean, signal: AbortSignal) => Promise<unknown>;
  const deadlines: Array<{ delay: number; expire(): void }> = [];
  const signals: AbortSignal[] = [];
  const api = load("src/presentation/hooks/use-market-context.ts", {
    "@/shared/lib/read-failure": failures,
    "@/presentation/hooks/use-polling-read": { usePollingRead: (options: { read: typeof read }) => {
      read = options.read;
      return { data: null, loading: true };
    } },
  }, {
    AbortSignal: {
      any: AbortSignal.any,
      timeout: (delay: number) => {
        const deadline = new AbortController();
        deadlines.push({ delay, expire: () => deadline.abort(new DOMException("timed out", "TimeoutError")) });
        return deadline.signal;
      },
    },
    fetch: (_url: string, { signal }: { signal: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      signals.push(signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  api.useMarketContext();
  const caller = new AbortController();
  const pending = read(false, caller.signal);
  assert.equal(deadlines[0].delay, 12_000);
  assert.equal(signals[0].aborted, false);
  deadlines[0].expire();
  await assert.rejects(pending, { name: "TimeoutError" });
  assert.equal(signals[0].aborted, true);
  assert.equal(caller.signal.aborted, false);

  const cancelled = read(false, caller.signal);
  caller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(signals[1].aborted, true);
});

test("unavailable market metrics do not show a zero delta, while a measured zero stays visible", () => {
  const deps = {
    ...ui(),
    "lucide-react": { Info: "info", ShieldAlert: "warning", ArrowDownRight: "down", ArrowUpRight: "up", Minus: "flat" },
    "@/shared/i18n/messages": { domainMessageKey: () => undefined },
    "@/presentation/ui/tooltip": { Tooltip: ({ children }: { children: unknown }) => children },
  };
  const api = load("src/presentation/widgets/right-rail/market-context-card.tsx", {
    ...deps,
    "@/presentation/ui/delta": load("src/presentation/ui/delta.tsx", deps),
  });
  for (const warning of [true, false]) {
    const rendered = api.MarketContextCard({ data: {
      ...marketFallback,
      dominance: { ...marketFallback.dominance, value: warning ? "—" : "59.12%", warning },
    } });
    const dominance = nodesOf(rendered).find((node) => textOf(node).trim().startsWith("BTC Dominance"))!;
    assert.ok(dominance, "the dominance metric must remain present");
    if (warning) {
      assert.match(textOf(dominance, true), /—/);
      assert.doesNotMatch(textOf(dominance, true), /0\.00%/);
      assert.ok(nodesOf(dominance).some(({ type }) => type === "warning"));
    } else {
      assert.match(textOf(dominance, true), /59\.12%.*0\.00%/);
    }
  }
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

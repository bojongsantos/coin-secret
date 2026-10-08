import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as derivatives from "@/core/domain/market/derivatives";
import * as format from "@/shared/lib/format";

function load(path: string, globals: Record<string, unknown>, dependencies: Record<string, unknown> = {}) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, Response, Date, Error, DOMException, AbortSignal, AbortController, performance, setTimeout, clearTimeout,
    require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
    ...globals,
  });
  return exports;
}

test("permanent exchange errors do not retry; transient faults recover", async () => {
  for (const status of [400, 404, 418]) {
    let calls = 0;
    const api = load("src/infrastructure/market-data/exchange-http.ts", { fetch: async () => { calls++; return new Response("{}", { status }); } });
    await assert.rejects(api.requestExchangeJson("https://exchange.invalid", "/test", "Test") as Promise<unknown>, new RegExp(String(status)));
    assert.equal(calls, 1);
  }
  for (const status of [429, 503]) {
    let calls = 0;
    const api = load("src/infrastructure/market-data/exchange-http.ts", {
      setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1; },
      fetch: async () => ++calls === 1 ? new Response("{}", { status }) : Response.json({ price: 42 }),
    });
    const value = await api.requestExchangeJson("https://exchange.invalid", "/test", "Test") as { price: number };
    assert.equal(value.price, 42);
    assert.equal(calls, 2);
  }
});

test("an already cancelled exchange read never reaches the provider", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const api = load("src/infrastructure/market-data/exchange-http.ts", { fetch: async () => { calls++; return Response.json({}); } });
  await assert.rejects(api.requestExchangeJson("https://exchange.invalid", "/test", "Test", controller.signal) as Promise<unknown>, /cancelled/);
  assert.equal(calls, 0);
});

function contextService(mode: "fallback" | "timeout" | "errors", failure?: unknown, timeoutScale = 100) {
  const requests: string[] = [];
  const budgets: number[] = [];
  const warnings: Array<{ event: string; detail: { provider: string; elapsedMs: number; code: string } }> = [];
  const api = load("src/infrastructure/market-data/market-context-service.ts", {
    console: { warn: (event: string, detail: { provider: string; elapsedMs: number; code: string }) => warnings.push({ event, detail }) },
    AbortSignal: {
      any: AbortSignal.any,
      timeout: (ms: number) => {
        budgets.push(ms);
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), ms / timeoutScale);
        return controller.signal;
      },
    },
    fetch: async (url: string, init: { signal: AbortSignal }) => {
      requests.push(url);
      if (url.includes("coingecko")) return Response.json({ data: { market_cap_percentage: { btc: 58 }, market_cap_change_percentage_24h_usd: 1 } });
      if (url.includes("alternative.me")) return Response.json({ data: [{ value: "71" }] });
      if (mode === "errors") throw failure;
      if (mode === "timeout") return new Promise<Response>((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      if (url.includes("binance")) return new Response("{}", { status: 451 });
      return Response.json({ result: { list: [{ fundingRate: "0.0001", openInterestValue: "9000000000" }] } });
    },
  }, {
    "@/core/domain/market/derivatives": derivatives,
    "@/shared/lib/format": format,
    "@/infrastructure/market-data/market-data-provider": { marketData: { fetchTicker24h: async () => ({ lastPrice: 80000, priceChangePercent: 1 }) } },
  });
  return { api, requests, budgets, warnings };
}

test("futures fallback reports the answering source and sanitized failure diagnostics", async () => {
  const { api, requests, warnings } = contextService("fallback");
  const payload = await api.getMarketContextPayload() as { context: { fundingRate: { warning: boolean; hint: string }; openInterest: { value: string } } };
  assert.equal(payload.context.fundingRate.warning, false);
  assert.match(payload.context.fundingRate.hint, /bybit/);
  assert.equal(payload.context.openInterest.value, "$9.0B");
  const diagnostic = api.getDerivativesDiagnostics() as { source: string; providers: Array<{ provider: string; detail: string }> };
  assert.equal(diagnostic.source, "bybit");
  assert.equal(diagnostic.providers[0].detail, "HTTP 451");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].detail.code, "HTTP_ERROR");
  assert.equal(requests.some((url) => url.includes("okx")), false);
  await api.getMarketContextPayload();
  assert.equal(requests.length, 5, "cached reads do not re-probe providers");
});

test("all stalled futures sources finish within the shared budget and never fabricate metrics", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { api, budgets, warnings } = contextService("timeout", undefined, 1);
  const started = Date.now();
  const pending = api.getMarketContextPayload() as Promise<{ context: { fundingRate: { warning: boolean; value: string }; openInterest: { warning: boolean } } }>;
  // Let promise continuations start each venue before advancing virtual time.
  // Real compressed timers can exhaust the shared budget under CPU contention.
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(budgets.filter((ms) => ms === 2500).length, attempt);
    t.mock.timers.tick(2500);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const payload = await pending;
  assert.equal(Date.now() - started, 7500);
  assert.ok(Date.now() - started < 8000, "provider deadlines should fit within the shared budget");
  assert.equal(budgets.filter((ms) => ms === 2500).length, 3);
  assert.ok(budgets.includes(8000));
  assert.equal(payload.context.fundingRate.warning, true);
  assert.equal(payload.context.fundingRate.value, "—");
  assert.equal(payload.context.openInterest.warning, true);
  const diagnostic = api.getDerivativesDiagnostics() as { source: string | null; providers: Array<{ detail: string }> };
  assert.equal(diagnostic.source, null);
  assert.equal(diagnostic.providers.length, 3);
  assert.ok(diagnostic.providers.every((row) => row.detail === "timeout"));
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every((warning) => warning.detail.code === "TIMEOUT"));

  const expired = contextService("timeout", undefined, 1);
  const expiredPending = expired.api.getMarketContextPayload() as Promise<unknown>;
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(8000);
  await expiredPending;
  const expiredDiagnostic = expired.api.getDerivativesDiagnostics() as { source: string | null; providers: Array<{ detail: string }> };
  assert.equal(expiredDiagnostic.source, null);
  assert.equal(expiredDiagnostic.providers.length, 1, "an exhausted shared budget prevents further provider attempts");
  assert.equal(expiredDiagnostic.providers[0].detail, "timeout");
});

test("provider warnings expose only allowlisted failure codes and preserve response diagnostics", async () => {
  const privateCanary = "private-diagnostic-canary";
  const failures: Array<[unknown, string]> = [
    [new Error(privateCanary, { cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID", headers: privateCanary } }), "ERR_TLS_CERT_ALTNAME_INVALID"],
    [Object.assign(new Error(privateCanary), { code: "ENOTFOUND" }), "ENOTFOUND"],
    [new SyntaxError(privateCanary), "JSON_PARSE_ERROR"],
    [new Error(privateCanary, { cause: { code: privateCanary } }), "UNKNOWN"],
    [Object.assign(new Error(privateCanary), { code: "ERR_UNLISTED", name: privateCanary }), "UNKNOWN"],
    [privateCanary, "UNKNOWN"],
  ];
  for (const [failure, code] of failures) {
    const { api, warnings } = contextService("errors", failure);
    const payload = await api.getMarketContextPayload() as { context: { fundingRate: { warning: boolean } } };
    assert.equal(payload.context.fundingRate.warning, true);
    assert.deepEqual(warnings.map((warning) => warning.detail.provider), ["binance", "bybit", "okx"]);
    for (const warning of warnings) {
      assert.equal(warning.event, "[market.derivatives.failure]");
      assert.deepEqual(Object.keys(warning.detail).sort(), ["code", "elapsedMs", "provider"]);
      assert.equal(warning.detail.code, code);
      assert.ok(Number.isInteger(warning.detail.elapsedMs) && warning.detail.elapsedMs >= 0);
    }
    assert.equal(JSON.stringify(warnings).includes(privateCanary), false);
    const diagnostic = api.getDerivativesDiagnostics() as { providers: Array<{ detail: string }> };
    assert.ok(diagnostic.providers.every((row) => row.detail === "network or response failure"));
    assert.equal(JSON.stringify(diagnostic).includes(code), false, "failure codes stay in server logs, not API diagnostics");
  }
});

function captureQueue(kind: "entry" | "result") {
  const clock = { now: 1_790_000_000_000 };
  class ClockDate extends Date {
    constructor(value?: string | number) { super(value ?? clock.now); }
    static now() { return clock.now; }
  }
  const rows = Array.from({ length: 26 }, (_, index) => ({
    id: String(index).padStart(3, "0"), symbol: `${index < 24 ? "BAD" : "GOOD"}${index}USDT`,
    firstStatus: kind === "entry" ? "Limit Order" : "Filled", status: "Running",
    resultCheckedAt: null as Date | null, resultAt: null as Date | null,
    snapshots: new Set<string>(kind === "result" ? ["ENTRY"] : []),
    timeframe: "15m", direction: "long", zoneBaseTime: 1000,
    entry: 100, stopLoss: 90, target1: 110, target2: 120, confidence: 75,
    riskReward: 2, zoneTop: 100, zoneBottom: 95,
  }));
  const reads: string[] = [];
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  const api = load("src/infrastructure/monitoring/setup-capture-service.ts", { Date: ClockDate }, {
    "@/config/default-watchlist": { DEFAULT_WATCHLIST: [] },
    "@/core/application/scanner/supply-demand-scan-service": { runSdScan: async () => ({ demand: [], supply: [], errors: [] }) },
    "@/core/domain/analysis/supply-demand": { publishedBaseIndex: () => 0, publishedScanLimit: () => 1000 },
    "@/core/domain/analysis/setup-lifecycle": { traceSetupLifecycle: () => ({ status: "Target 2 reached", filledIndex: 1, target2Index: 2, stopIndex: null }) },
    "@/core/domain/promo/capture-trigger": { isFilledStatus: () => true },
    "@/core/domain/promo/proof-image": { proofWindow: () => ({ from: 0, to: 3 }) },
    "@/infrastructure/persistence/active-setup-store": { activeSetupStore: {} },
    "@/infrastructure/market-data/market-data-provider": { marketData: { fetchKlines: async ({ symbol }: { symbol: string }) => {
      reads.push(symbol);
      if (symbol.startsWith("BAD")) throw new Error("delisted");
      return [1000, 1900, 2800].map((time) => ({ time, open: 100, high: 120, low: 95, close: 110, volume: 1 }));
    } } },
    "@/infrastructure/database/prisma": { prisma: {
      trackedSetup: {
        findMany: async (query: { where: { firstStatus?: string; OR: Array<{ resultCheckedAt: null | { lte: Date } }> }; take: number }) => {
          assert.equal(query.where.OR.length, 2, "capture reads must honor the backoff window");
          const cutoff = query.where.OR[1].resultCheckedAt?.lte.getTime() ?? -Infinity;
          return rows.filter((row) => (!row.resultCheckedAt || row.resultCheckedAt.getTime() <= cutoff) &&
            (query.where.firstStatus ? row.firstStatus === "Limit Order" && !row.snapshots.has("ENTRY") :
              row.resultAt === null && row.snapshots.has("ENTRY")))
            .sort((a, b) => (a.resultCheckedAt?.getTime() ?? 0) - (b.resultCheckedAt?.getTime() ?? 0) || a.id.localeCompare(b.id))
            .slice(0, query.take);
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          writes.push({ id: where.id, data });
          Object.assign(rows.find((row) => row.id === where.id)!, data);
        },
      },
      setupSnapshot: { upsert: async ({ create }: { create: { setupId: string; kind: string } }) => {
        rows.find((row) => row.id === create.setupId)!.snapshots.add(create.kind);
      } },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    } },
  });
  return { api, rows, reads, writes, clock };
}

for (const kind of ["entry", "result"] as const) {
  test(`failed ${kind} reads advance the queue, back off, and let valid terminal setups publish`, async () => {
    const { api, rows, reads, writes, clock } = captureQueue(kind);
    await api.runSetupCapture();
    assert.equal(reads.length, 24);
    assert.equal(writes.length, 24);
    assert.ok(writes.every((write) => Object.keys(write.data).join() === "resultCheckedAt"), "failure must not fabricate a status");
    clock.now += 1000;
    await api.runSetupCapture();
    assert.ok(rows.slice(24).every((row) => row.snapshots.has("RESULT") && row.resultAt), "valid queue tail must produce its proof");
    assert.equal(reads.filter((symbol) => symbol.startsWith("BAD")).length, 24, "failed records wait before retrying");
    assert.ok(rows.slice(0, 24).every((row) => row.status === "Running" && row.resultAt === null));
    clock.now += 5 * 60_000;
    await api.runSetupCapture();
    assert.equal(reads.filter((symbol) => symbol.startsWith("BAD")).length, 48, "backoff expires without dropping records forever");
  });
}

function pollingHook(path: string, hookName: string, payload: unknown) {
  const state: unknown[] = [];
  const timers: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  const requests: Array<{ url: string; body?: string }> = [];
  const budgets: number[] = [];
  const mode = { stalled: false };
  const api = load(path, {
    console: { error() {} },
    window: {
      setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
      setInterval: () => 1, clearTimeout() {}, clearInterval() {},
    },
    AbortSignal: {
      any: AbortSignal.any,
      timeout: (ms: number) => {
        budgets.push(ms);
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), 15);
        return controller.signal;
      },
    },
    fetch: async (url: string, init: { signal: AbortSignal; body?: string }) => {
      signals.push(init.signal);
      requests.push({ url, body: init.body });
      if (mode.stalled) return new Promise<Response>((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      return Response.json(payload);
    },
  }, {
    react: {
      useState: (initial: unknown) => { const index = state.length; state.push(initial); return [initial, (value: unknown) => { state[index] = value; }]; },
      useRef: (initial: unknown) => ({ current: initial }),
      useCallback: (callback: unknown) => callback,
      useEffect: (effect: () => (() => void)) => { cleanups.push(effect()); },
    },
  });
  const hook = api[hookName]() as { refresh(): void };
  return { hook, state, signals, budgets, requests, mode, kickoff: () => timers[0](), unmount: () => cleanups.forEach((cleanup) => cleanup()) };
}

test("market refresh calls the context endpoint, times out, clears stale metrics and recovers", async () => {
  const payload = { context: { btc: { value: "80K" } }, sentiment: { score: 71 } };
  const harness = pollingHook("src/presentation/hooks/use-market-context.ts", "useMarketContext", payload);
  harness.kickoff();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(harness.state[0]);
  harness.mode.stalled = true;
  harness.hook.refresh();
  harness.hook.refresh();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(harness.requests.length, 2, "refresh stays single-flight");
  assert.equal(harness.state[0], null);
  assert.equal(harness.state[1], null);
  assert.equal(harness.state[2], false, "timeout releases the spinner");
  harness.mode.stalled = false;
  harness.hook.refresh();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(harness.state[0]);
  assert.ok(harness.requests.every((request) => request.url === "/api/market-context"));
  assert.ok(harness.budgets.every((budget) => budget === 45000));
  harness.mode.stalled = true;
  harness.hook.refresh();
  const stateAtUnmount = harness.state.slice();
  harness.unmount();
  assert.equal(harness.signals.at(-1)?.aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.state, stateAtUnmount, "cancelled work must not write state after unmount");
});

test("signals wait is bounded, returns no stale setup after failure, and cancels on unmount", async () => {
  const payload = { result: { demand: [], supply: [], errors: [], scannedAt: "2026-10-05" }, top: [] };
  const harness = pollingHook("src/presentation/hooks/use-scanner.ts", "useDashboardSignals", payload);
  harness.kickoff();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(harness.state[0]);
  harness.mode.stalled = true;
  harness.hook.refresh();
  harness.hook.refresh();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.state[0], null);
  assert.equal(harness.state[1], false);
  assert.ok(harness.state[2]);
  harness.hook.refresh();
  const stateAtUnmount = harness.state.slice();
  harness.unmount();
  assert.equal(harness.signals[2].aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.state, stateAtUnmount);
  assert.ok(harness.budgets.every((budget) => budget === 90000));
  assert.equal(JSON.parse(harness.requests[0].body!).limit, 5);
});

test("disabling polling hides a previous busy flag and prevents manual requests", () => {
  for (const [path, hook] of [
    ["src/presentation/hooks/use-scanner.ts", "useSdScan"],
    ["src/presentation/hooks/use-market-context.ts", "useMarketContext"],
  ]) {
    let calls = 0;
    const api = load(path, { fetch: () => { calls++; throw new Error("must stay disabled"); } }, {
      react: {
        // Models the stored loading=true value from a request cancelled when
        // enabled changes to false; it must not leave the disabled view busy.
        useState: (initial: unknown) => [typeof initial === "boolean" ? true : initial, () => undefined],
        useRef: (initial: unknown) => ({ current: initial }),
        useCallback: (callback: unknown) => callback,
        useEffect() {},
      },
    });
    const view = api[hook](false) as { loading: boolean; refresh(): void };
    assert.equal(view.loading, false);
    view.refresh();
    assert.equal(calls, 0);
  }
});

test("the Overview refresh control uses market data and its own loading state", () => {
  const marketRefresh = () => undefined;
  const scanRefresh = () => undefined;
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    react: { useState: (value: unknown) => [value, () => undefined] },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { Loader2: "loader" },
    "@/core/application/market-data/history-plan": { rangeForTimeframe: () => "month" },
    "@/core/domain/market/symbol": { normalizeUsdtSymbol: (value: string) => value, isValidBinanceSymbol: () => true },
    "@/presentation/hooks/use-scanner": { useDashboardSignals: () => ({ top: [], result: null, loading: true, refresh: scanRefresh }) },
    "@/presentation/hooks/use-market-context": { useMarketContext: () => ({ context: null, sentiment: null, loading: false, refresh: marketRefresh }) },
    "@/presentation/hooks/use-live-analysis": { useLiveAnalysis: () => ({ analysis: null, publishedTimeframe: null }) },
  };
  for (const [module, name] of [
    ["features/analysis/analysis-view", "AnalysisView"], ["features/dashboard/market-overview", "MarketOverview"],
    ["features/dashboard/top-setups-strip", "TopSetupsStrip"], ["features/signals/signals-board", "SignalsBoard"],
    ["layout/app-shell", "AppShell"], ["ui/reveal", "Reveal"],
  ]) dependencies[`@/presentation/${module}`] = { [name]: name };
  const api = load("src/presentation/features/dashboard/dashboard-client.tsx", {}, dependencies);
  const tree = api.DashboardClient() as { props: { children: { props: { children: Array<{ props: { onRefresh: unknown; refreshing: boolean } }> } } } };
  const [overview, signals] = tree.props.children.props.children;
  assert.equal(overview.props.onRefresh, marketRefresh);
  assert.equal(overview.props.refreshing, false);
  assert.equal(signals.props.onRefresh, scanRefresh);
  assert.equal(signals.props.refreshing, undefined);
});

test("market context responses cannot be retained as a stale CDN snapshot", async () => {
  let offline = false;
  let calls = 0;
  const api = load("src/app/api/market-context/route.ts", { console: { error() {} } }, {
    "@/infrastructure/market-data/market-context-service": { getMarketContextPayload: async () => {
      calls++;
      if (offline) throw new Error("provider unavailable");
      return { fetchedAt: "2026-10-05T00:00:00Z", context: {}, sentiment: {} };
    } },
  });
  const available = await api.GET() as Response;
  assert.equal(available.status, 200);
  assert.equal(available.headers.get("cache-control"), "no-store");
  offline = true;
  const unavailable = await api.GET() as Response;
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.equal(calls, 2, "each UI request must reach the service-owned cache");
  assert.deepEqual(await unavailable.json(), { error: "Market context unavailable" });
});

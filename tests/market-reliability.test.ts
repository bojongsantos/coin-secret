import test from "node:test";
import assert from "node:assert/strict";
import * as sourceSelection from "@/core/application/market-data/source-selection";
import * as marketExchanges from "@/core/domain/market/exchange";
import { readFileSync } from "node:fs";
import { getEventListeners } from "node:events";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as derivatives from "@/core/domain/market/derivatives";
import * as format from "@/shared/lib/format";
import * as readFailures from "@/shared/lib/read-failure";

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

function stalledRead<T>(signal: AbortSignal): Promise<T> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

type ContextSpotRead = (symbol: string, signal: AbortSignal) => Promise<{ lastPrice: number; priceChangePercent: number }>;

function contextService(mode: "fallback" | "timeout" | "errors", failure?: unknown, timeoutScale = 100, options: {
  spot?: ContextSpotRead;
  fallbackSpot?: ContextSpotRead;
  optionalStalled?: boolean;
  externalRead?: (url: string, signal: AbortSignal) => Promise<Response> | undefined;
} = {}) {
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
      const override = options.externalRead?.(url, init.signal);
      if (override) return override;
      if (options.optionalStalled && (url.includes("coingecko") || url.includes("alternative.me"))) return stalledRead<Response>(init.signal);
      if (url.includes("coingecko")) return Response.json({ data: { market_cap_percentage: { btc: 58 }, market_cap_change_percentage_24h_usd: 1 } });
      if (url.includes("alternative.me")) return Response.json({ data: [{ value: "71" }] });
      if (mode === "errors") throw failure;
      if (mode === "timeout") return stalledRead<Response>(init.signal);
      if (url.includes("binance")) return new Response("{}", { status: 451 });
      return Response.json({ result: { list: [{ fundingRate: "0.0001", openInterestValue: "9000000000" }] } });
    },
  }, {
    "@/core/application/market-data/source-selection": sourceSelection,
    "@/core/domain/market/derivatives": derivatives,
    "@/shared/lib/format": format,
    "@/infrastructure/market-data/market-data-provider": { marketData: { sources: [
      { exchange: "binance", marketData: { fetchTicker24h: options.spot ?? (async () => ({ lastPrice: 80000, priceChangePercent: 1 })) } },
      ...(options.fallbackSpot ? [{ exchange: "bybit", marketData: { fetchTicker24h: options.fallbackSpot } }] : []),
    ] } },
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
    assert.equal(budgets.filter((ms) => ms === 2500).length, 3 + attempt, "spot and optional feeds also have short deadlines");
    t.mock.timers.tick(2500);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const payload = await pending;
  assert.equal(Date.now() - started, 7500);
  assert.ok(Date.now() - started < 8000, "provider deadlines should fit within the shared budget");
  assert.equal(budgets.filter((ms) => ms === 2500).length, 6);
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

test("stalled core venues are cancelled and settle before the browser request deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const signals: AbortSignal[] = [];
  const stall: ContextSpotRead = (_symbol, signal) => { signals.push(signal); return stalledRead(signal); };
  const { api, requests } = contextService("fallback", undefined, 1, { spot: stall, fallbackSpot: stall });
  const started = Date.now();
  const pending = api.getMarketContextPayload() as Promise<unknown>;
  const rejected = assert.rejects(pending, /Core exchange ticker data is unavailable/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(signals.length, 2);
  t.mock.timers.tick(2500);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(signals.length, 4, "the second venue starts after the first venue deadline");
  t.mock.timers.tick(2500);
  await rejected;
  assert.equal(Date.now() - started, 5000);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(requests.length, 2, "no futures reads begin without core prices");
});

test("a slow primary spot venue leaves time for a complete fallback price pair", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const primarySignals: AbortSignal[] = [];
  const fallbackSymbols: string[] = [];
  const { api } = contextService("fallback", undefined, 1, {
    spot: (_symbol, signal) => { primarySignals.push(signal); return stalledRead(signal); },
    fallbackSpot: async (symbol) => {
      fallbackSymbols.push(symbol);
      return { lastPrice: symbol === "BTCUSDT" ? 86000 : 2500, priceChangePercent: 2 };
    },
  });
  const pending = api.getMarketContextPayload() as Promise<{ context: { btc: { value: string }; eth: { value: string } } }>;
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(2500);
  const payload = await pending;
  assert.deepEqual(fallbackSymbols, ["BTCUSDT", "ETHUSDT"]);
  assert.ok(primarySignals.every((signal) => signal.aborted));
  assert.equal(payload.context.btc.value, format.formatCompact(86000));
  assert.equal(payload.context.eth.value, format.formatCompact(2500));
});

test("a failed spot half cancels its sibling before selecting a new complete pair", async () => {
  let cancelled = false;
  const { api } = contextService("fallback", undefined, 1, {
    spot: (symbol, signal) => {
      if (symbol === "ETHUSDT") return Promise.reject(new Error("provider down"));
      signal.addEventListener("abort", () => { cancelled = true; }, { once: true });
      return stalledRead(signal);
    },
    fallbackSpot: async () => ({ lastPrice: 90000, priceChangePercent: 1 }),
  });
  await api.getMarketContextPayload();
  assert.equal(cancelled, true);
});

test("stalled optional feeds do not postpone futures and return honest unavailable metrics", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { api, requests } = contextService("fallback", undefined, 1, { optionalStalled: true });
  const pending = api.getMarketContextPayload() as Promise<{
    context: { dominance: { warning: boolean }; fundingRate: { warning: boolean } };
    sentiment: { available: boolean };
  }>;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(requests.some((url) => url.includes("bybit")), "futures finish while optional feeds are still pending");
  t.mock.timers.tick(2500);
  const payload = await pending;
  assert.equal(payload.context.fundingRate.warning, false);
  assert.equal(payload.context.dominance.warning, true);
  assert.equal(payload.sentiment.available, false);
});

test("the overview deadline bounds futures after spot fallback consumes part of its budget", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { api, requests } = contextService("timeout", undefined, 1, {
    spot: (_symbol, signal) => stalledRead(signal),
    fallbackSpot: async () => ({ lastPrice: 80000, priceChangePercent: 1 }),
  });
  const started = Date.now();
  const pending = api.getMarketContextPayload() as Promise<{ context: { fundingRate: { warning: boolean }; openInterest: { warning: boolean } } }>;
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const step of [2500, 2500, 2500, 500]) {
    t.mock.timers.tick(step);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const payload = await pending;
  assert.equal(Date.now() - started, 8000);
  assert.equal(payload.context.fundingRate.warning, true);
  assert.equal(payload.context.openInterest.warning, true);
  assert.equal(requests.length, 7, "the final futures venue receives only the remaining half second");
  const diagnostic = api.getDerivativesDiagnostics() as { source: string | null; providers: Array<{ detail: string }> };
  assert.equal(diagnostic.source, null);
  assert.equal(diagnostic.providers.length, 3);
  assert.ok(diagnostic.providers.every((row) => row.detail === "timeout"));
});

test("a rejected overview remains single-flight and clears the promise for the next retry", async () => {
  let down = true;
  let calls = 0;
  const { api, requests } = contextService("fallback", undefined, 1, {
    spot: async () => {
      calls++;
      if (down) throw new Error("provider down");
      return { lastPrice: 80000, priceChangePercent: 1 };
    },
  });
  const first = api.getMarketContextPayload() as Promise<unknown>;
  assert.equal(api.getMarketContextPayload(), first);
  await assert.rejects(first, /Core exchange ticker data is unavailable/);
  down = false;
  const retry = api.getMarketContextPayload() as Promise<unknown>;
  assert.notEqual(retry, first);
  await retry;
  const reads = requests.length;
  await api.getMarketContextPayload();
  assert.equal(calls, 4);
  assert.equal(requests.length, reads, "a recovered result uses the normal snapshot cache");
});

test("a noncooperative spot venue cannot prevent fallback or overwrite its cached prices later", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const late: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  const { api, warnings } = contextService("fallback", undefined, 1, {
    spot: (_symbol, signal) => {
      signals.push(signal);
      return new Promise((resolve) => late.push(() => resolve({ lastPrice: 1, priceChangePercent: 0 })));
    },
    fallbackSpot: async () => ({ lastPrice: 86000, priceChangePercent: 2 }),
  });
  const pending = api.getMarketContextPayload() as Promise<{ context: { btc: { value: string } } }>;
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(2500);
  const payload = await pending;
  assert.equal(payload.context.btc.value, format.formatCompact(86000));
  assert.ok(signals.every((signal) => signal.aborted), "native cancellation still reaches the abandoned reads");
  const spotWarning = warnings.find((warning) => warning.event === "[market.spot.failure]");
  assert.equal(spotWarning?.detail.provider, "binance");
  assert.equal(spotWarning?.detail.code, "TIMEOUT");
  late.forEach((finish) => finish());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await api.getMarketContextPayload(), payload, "late primary data cannot replace the fallback snapshot");
});

test("noncooperative core and optional reads cannot poison the overview single-flight", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let down = true;
  const lateFailures: Array<() => void> = [];
  const stall: ContextSpotRead = () => down
    ? new Promise((_, reject) => lateFailures.push(() => reject(new Error("late provider failure"))))
    : Promise.resolve({ lastPrice: 80000, priceChangePercent: 1 });
  const { api } = contextService("fallback", undefined, 1, {
    spot: stall, fallbackSpot: stall,
    externalRead: () => down ? new Promise(() => {}) : undefined,
  });
  const first = api.getMarketContextPayload() as Promise<unknown>;
  assert.equal(api.getMarketContextPayload(), first);
  const rejected = assert.rejects(first, /Core exchange ticker data is unavailable/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const step of [2500, 2500]) {
    t.mock.timers.tick(step);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await rejected;
  down = false;
  const retry = api.getMarketContextPayload() as Promise<unknown>;
  assert.notEqual(retry, first);
  const recovered = await retry;
  lateFailures.forEach((fail) => fail());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await api.getMarketContextPayload(), recovered, "late rejection is handled and cannot disturb recovery");
});

test("optional response decoding that ignores abort cannot keep the overview pending", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const lateBodies: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  const { api } = contextService("fallback", undefined, 1, {
    externalRead: (url, signal) => {
      if (!url.includes("coingecko") && !url.includes("alternative.me")) return;
      signals.push(signal);
      const response = Response.json({});
      response.json = () => new Promise((resolve) => lateBodies.push(() => resolve({ data: [{ value: "99" }] })));
      return Promise.resolve(response);
    },
  });
  const pending = api.getMarketContextPayload() as Promise<{ sentiment: { available: boolean } }>;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(lateBodies.length, 2);
  t.mock.timers.tick(2500);
  const payload = await pending;
  assert.equal(payload.sentiment.available, false);
  assert.ok(signals.every((signal) => signal.aborted));
  lateBodies.forEach((finish) => finish());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await api.getMarketContextPayload(), payload);
  assert.equal(payload.sentiment.available, false);
});

test("noncooperative futures respect the remaining deadline and cannot publish late diagnostics", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let down = true;
  const late: Array<() => void> = [];
  const optionalSignals: AbortSignal[] = [];
  const { api } = contextService("fallback", undefined, 1, {
    spot: (_symbol, signal) => down ? stalledRead(signal) : Promise.resolve({ lastPrice: 81000, priceChangePercent: 2 }),
    fallbackSpot: async () => ({ lastPrice: 80000, priceChangePercent: 1 }),
    externalRead: (url, signal) => {
      if (url.includes("coingecko") || url.includes("alternative.me")) { optionalSignals.push(signal); return; }
      if (!down) return;
      return new Promise((resolve) => late.push(() => resolve(Response.json({ lastFundingRate: "0.0001", openInterest: "1000" }))));
    },
  });
  const started = Date.now();
  const pending = api.getMarketContextPayload() as Promise<{ context: { fundingRate: { warning: boolean } } }>;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(optionalSignals.every((signal) => !signal.aborted));
  assert.ok(optionalSignals.every((signal) => getEventListeners(signal, "abort").length === 0), "completed reads remove their abort listeners before the overview finishes");
  for (const step of [2500, 2500, 2500, 500]) {
    t.mock.timers.tick(step);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(Date.now() - started, 8000);
  assert.equal((await pending).context.fundingRate.warning, true);
  down = false;
  const current = await api.getMarketContextPayload(true);
  const diagnostic = api.getDerivativesDiagnostics();
  assert.equal((diagnostic as { source: string }).source, "bybit");
  late.forEach((finish) => finish());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(api.getDerivativesDiagnostics(), diagnostic);
  assert.equal(await api.getMarketContextPayload(), current);
});

test("spot warnings expose only safe fields and allowlisted failure codes", async () => {
  const privateCanary = "private-spot-canary";
  const { api, warnings } = contextService("fallback", undefined, 100, {
    spot: async () => { throw new Error(privateCanary, { cause: { code: "ECONNREFUSED", headers: privateCanary } }); },
    fallbackSpot: async () => ({ lastPrice: 80000, priceChangePercent: 1 }),
  });
  await api.getMarketContextPayload();
  const spot = warnings.filter((warning) => warning.event === "[market.spot.failure]");
  assert.equal(spot.length, 1);
  assert.deepEqual(Object.keys(spot[0].detail).sort(), ["code", "elapsedMs", "provider"]);
  assert.equal(spot[0].detail.code, "ECONNREFUSED");
  assert.equal(spot[0].detail.provider, "binance");
  assert.ok(Number.isInteger(spot[0].detail.elapsedMs) && spot[0].detail.elapsedMs >= 0);
  assert.equal(JSON.stringify(warnings).includes(privateCanary), false);
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

function captureQueue(kind: "entry" | "result", busy = false) {
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
    timeframe: "15m", direction: "long", zoneBaseTime: 1000, exchange: "binance" as string | null,
    archivedAt: null as Date | null,
    entry: 100, stopLoss: 90, target1: 110, target2: 120, confidence: 75,
    riskReward: 2, zoneTop: 100, zoneBottom: 95,
  }));
  const reads: string[] = [];
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  let boardRefreshes = 0;
  let onRead: (symbol: string) => void = () => {};
  let afterUpdate: (id: string) => void = () => {};
  const updateMany = async ({ where, data }: { where: { id: string; archivedAt: null; status: string; resultAt?: null; snapshots?: { none: { kind: string } } }; data: Record<string, unknown> }) => {
    const row = rows.find((row) => row.id === where.id);
    if (!row || row.archivedAt || row.status !== where.status || where.resultAt === null && row.resultAt !== null
      || where.snapshots && row.snapshots.has(where.snapshots.none.kind)) return { count: 0 };
    writes.push({ id: where.id, data });
    Object.assign(row, data);
    afterUpdate(where.id);
    return { count: 1 };
  };
  const upsert = async ({ create }: { create: { setupId: string; kind: string } }) => {
    rows.find((row) => row.id === create.setupId)!.snapshots.add(create.kind);
  };
  const captureActiveSetups = {};
  const captureSnapshots = {};
  const captureMarket = { fetchKlines: async ({ symbol }: { symbol: string }) => {
    reads.push(symbol);
    onRead(symbol);
    if (symbol.startsWith("BAD")) throw new Error("delisted");
    return [1000, 1900, 2800].map((time) => ({ time, open: 100, high: 120, low: 95, close: 110, volume: 1 }));
  } };
  const api = load("src/infrastructure/monitoring/setup-capture-service.ts", { Date: ClockDate }, {
    "@/config/default-watchlist": { DEFAULT_WATCHLIST: [] },
    "@/core/application/scanner/published-board-service": { refreshPublishedBoard: async (input: {
      marketData: unknown; symbols: unknown[]; activeSetups: unknown; snapshots: unknown;
    }) => {
      boardRefreshes += 1;
      assert.equal(input.marketData, captureMarket);
      assert.equal(input.activeSetups, captureActiveSetups);
      assert.equal(input.snapshots, captureSnapshots);
      assert.deepEqual(Array.from(input.symbols), []);
      return { result: { demand: [], supply: [], errors: [], scannedAt: new ClockDate().toISOString() }, stale: false, refreshing: busy, snapshotPublished: !busy };
    } },
    "@/core/application/market-data/source-selection": sourceSelection,
    "@/core/domain/market/exchange": marketExchanges,
    "@/core/domain/analysis/supply-demand": { publishedBaseIndex: () => 0, publishedScanLimit: () => 1000 },
    "@/core/domain/analysis/setup-lifecycle": { isTerminalSetupStatus: (status: string) => ["Target 2 reached", "Invalidated (SL hit)", "Missed"].includes(status), traceSetupLifecycle: () => ({ status: "Target 2 reached", filledIndex: 1, target2Index: 2, stopIndex: null }) },
    "@/core/domain/promo/capture-trigger": { isFilledStatus: () => true },
    "@/core/domain/promo/proof-image": { proofWindow: () => ({ from: 0, to: 3 }) },
    "@/infrastructure/persistence/active-setup-store": { activeSetupStore: captureActiveSetups },
    "@/infrastructure/persistence/signals-snapshot-store": { signalsSnapshotStore: captureSnapshots },
    "@/infrastructure/market-data/market-data-provider": { marketData: captureMarket, marketDataSources: [{ exchange: "binance", marketData: captureMarket }] },
    "@/infrastructure/monitoring/signals-publication": { readSignalsPublication: async () => ({ status: "fresh", durable: true, verified: true, scannedAt: new ClockDate().toISOString(), checkedAt: new ClockDate().toISOString(), ageSeconds: 0 }) },
    "@/infrastructure/database/prisma": { prisma: {
      trackedSetup: {
        findMany: async (query: { where: { archivedAt: null; exchange: { in: string[] }; firstStatus?: string; OR: Array<{ resultCheckedAt: null | { lte: Date } }> }; take: number }) => {
          assert.equal(query.where.archivedAt, null, "archived setups must stay out of both proof queues");
          assert.deepEqual(Array.from(query.where.exchange.in), ["binance", "bybit"], "proofs require a recorded exchange");
          assert.equal(query.where.OR.length, 2, "capture reads must honor the backoff window");
          const cutoff = query.where.OR[1].resultCheckedAt?.lte.getTime() ?? -Infinity;
          return rows.filter((row) => row.archivedAt === null && query.where.exchange.in.includes(row.exchange ?? "") &&
            (!row.resultCheckedAt || row.resultCheckedAt.getTime() <= cutoff) &&
            (query.where.firstStatus ? row.firstStatus === "Limit Order" && !row.snapshots.has("ENTRY") :
              row.resultAt === null && row.snapshots.has("ENTRY")))
            .sort((a, b) => (a.resultCheckedAt?.getTime() ?? 0) - (b.resultCheckedAt?.getTime() ?? 0) || a.id.localeCompare(b.id))
            .slice(0, query.take).map((row) => ({ ...row, snapshots: new Set(row.snapshots) }));
        },
        updateMany,
      },
      setupSnapshot: { upsert },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ trackedSetup: { updateMany }, setupSnapshot: { upsert } }),
    } },
  });
  return { api, rows, reads, writes, clock, boardRefreshes: () => boardRefreshes,
    race: (run: (symbol: string) => void) => { onRead = run; },
    raceAfterUpdate: (run: (id: string) => void) => { afterUpdate = run; } };
}

test("capture entry/result writers cannot overwrite concurrent terminal outcomes or create proofs after archival", async () => {
  for (const kind of ["entry", "result"] as const) {
    for (const action of ["archive", "terminal"] as const) {
      const f = captureQueue(kind);
      const first = f.rows[0];
      first.symbol = "GOODRACEUSDT";
      f.race((symbol) => {
        if (symbol !== first.symbol) return;
        if (action === "archive") first.archivedAt = new Date(f.clock.now);
        else first.status = "Invalidated (SL hit)";
      });
      await f.api.runSetupCapture();
      assert.equal(first.status, action === "archive" ? "Running" : "Invalidated (SL hit)");
      assert.equal(f.writes.some((write) => write.id === first.id), false);
      assert.equal(first.snapshots.has(kind === "entry" ? "ENTRY" : "RESULT"), false);
    }
  }
});

test("a busy coordinated refresh returns in-progress before dispatching proof reads or writes", async () => {
  const f = captureQueue("entry", true);
  const report = await f.api.runSetupCapture() as { publication: { status: string; verified: boolean } };
  assert.equal(report.publication.status, "in-progress");
  assert.equal(report.publication.verified, false);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.writes, []);
});

test("archival between lifecycle CAS and entry proof transaction prevents the snapshot", async () => {
  const f = captureQueue("entry");
  const first = f.rows[0];
  first.symbol = "GOODRACEUSDT";
  f.raceAfterUpdate((id) => { if (id === first.id) first.archivedAt = new Date(f.clock.now); });
  await f.api.runSetupCapture();
  assert.ok(first.archivedAt);
  assert.equal(first.snapshots.has("ENTRY"), false);
  assert.equal(first.snapshots.has("RESULT"), false);
});

test("the existing capture sweep refreshes and publishes the board exactly once before checking proof queues", async () => {
  const f = captureQueue("entry");
  await f.api.runSetupCapture();
  assert.equal(f.boardRefreshes(), 1);
  await f.api.runSetupCapture();
  assert.equal(f.boardRefreshes(), 2);
});

for (const kind of ["entry", "result"] as const) {
  test(`archived setups and setups with an unknown exchange never enter the ${kind} proof queue`, async () => {
    const { api, rows, reads, writes, clock } = captureQueue(kind);
    const archived = rows[24];
    const unknown = rows[25];
    archived.archivedAt = new Date(clock.now);
    unknown.exchange = null;
    await api.runSetupCapture();
    clock.now += 5 * 60_000;
    await api.runSetupCapture();
    assert.ok(!reads.includes(archived.symbol) && !reads.includes(unknown.symbol));
    assert.ok(writes.every((write) => write.id !== archived.id && write.id !== unknown.id));
    for (const row of [archived, unknown]) {
      assert.equal(row.resultCheckedAt, null);
      assert.equal(row.resultAt, null);
      assert.equal(row.status, "Running");
      assert.equal(row.snapshots.has("RESULT"), false);
      assert.equal(row.snapshots.has("ENTRY"), kind === "result");
    }
  });

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
  type Cell = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
  const cells: Cell[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const signals: AbortSignal[] = [];
  const deadlines: AbortController[] = [];
  const requests: Array<{ url: string; body?: string }> = [];
  const budgets: number[] = [];
  const mode = { stalled: false, failure: null as unknown, status: 200, retryAfter: null as string | null, payload };
  const access = { authenticated: true, plan: "premium", fullAccess: true, canAccess: () => access.fullAccess };
  const clock = { now: 1_790_000_000_000 };
  class ClockDate extends Date {
    constructor(value?: string | number) { super(value ?? clock.now); }
    static now() { return clock.now; }
  }
  let cursor = 0;
  let timerId = 0;
  let revision = 0;
  let args: unknown[] = [];
  let effects: Array<() => void> = [];
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && b.every((value, index) => Object.is(value, a[index]));
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++;
      cells[index] ??= { value: initial };
      return [cells[index].value, (value: unknown) => {
        cells[index].value = typeof value === "function" ? value(cells[index].value) : value;
        revision++;
      }];
    },
    useRef: (initial: unknown) => {
      const index = cursor++;
      cells[index] ??= { value: { current: initial } };
      return cells[index].value;
    },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const index = cursor++;
      if (!same(cells[index]?.deps, deps)) cells[index] = { value: callback, deps };
      return cells[index].value;
    },
    useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
      const index = cursor++;
      if (same(cells[index]?.deps, deps)) return;
      const previous = cells[index]?.cleanup;
      cells[index] = { deps };
      effects.push(() => { previous?.(); cells[index].cleanup = effect(); });
    },
  };
  const browserWindow = Object.assign(new EventTarget(), {
    setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const browserDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const browserNavigator = { onLine: true };
  const globals = {
    Date: ClockDate, window: browserWindow, document: browserDocument, navigator: browserNavigator,
    AbortSignal: {
      any: AbortSignal.any,
      timeout: (ms: number) => { budgets.push(ms); const deadline = new AbortController(); deadlines.push(deadline); return deadline.signal; },
    },
    fetch: async (url: string, init: { signal: AbortSignal; body?: string }) => {
      signals.push(init.signal);
      requests.push({ url, body: init.body });
      if (mode.stalled) return new Promise<Response>((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      if (mode.failure) throw mode.failure;
      return Response.json(mode.payload, { status: mode.status, headers: mode.retryAfter ? { "Retry-After": mode.retryAfter } : undefined });
    },
  };
  const polling = load("src/presentation/hooks/use-polling-read.ts", globals, { react, "@/shared/lib/read-failure": readFailures });
  const api = load(path, globals, {
    react, "@/shared/lib/read-failure": readFailures, "@/presentation/hooks/use-polling-read": polling,
    "@/presentation/features/access/plan-provider": { usePlan: () => access },
    "@/infrastructure/auth/auth-client": { AUTH_STATE_CHANGED_EVENT: "coinsecret:auth-state-changed" },
  });
  type View = {
    context?: unknown; sentiment?: unknown; result?: unknown; top?: unknown[];
    loading: boolean; error: string | null; lastUpdated: string | null; stale: boolean; refresh(): void;
  };
  const render = (...next: unknown[]) => {
    if (next.length) args = next;
    cursor = 0;
    effects = [];
    const view = api[hookName](...args) as View;
    effects.forEach((effect) => effect());
    return view;
  };
  const runTimer = () => {
    const entry = timers.entries().next().value as [number, { callback: () => void }] | undefined;
    assert.ok(entry, "polling should schedule a read");
    timers.delete(entry[0]);
    entry[1].callback();
  };
  const initial = render();
  return {
    initial, render, signals, budgets, requests, mode, access, clock, window: browserWindow,
    document: browserDocument, navigator: browserNavigator, runTimer,
    nextDelay: () => timers.values().next().value?.delay,
    timeout: () => deadlines.at(-1)?.abort(new DOMException("timed out", "TimeoutError")),
    revision: () => revision,
    unmount: () => cells.forEach((cell) => cell.cleanup?.()),
  };
}

const settlePolling = () => new Promise<void>((resolve) => setImmediate(resolve));
const marketPayload = { context: { btc: { value: "80K" } }, sentiment: { score: 71 }, fetchedAt: "2026-10-05T00:00:00Z" };
const signalsPayload = { result: { demand: [{ symbol: "BTCUSDT" }], supply: [], demandTotal: 1, supplyTotal: 0, errors: [], scannedAt: "2026-10-05T00:00:00Z" }, top: [] };

test("a stored board stays visible and labelled stale while polling for a background scan", async () => {
  const harness = pollingHook("src/presentation/hooks/use-scanner.ts", "useDashboardSignals", { ...signalsPayload, stale: true, refreshing: true });
  harness.runTimer(); await settlePolling();
  const stored = harness.render();
  assert.ok(stored.result);
  assert.equal(stored.stale, true);
  assert.equal(stored.lastUpdated, signalsPayload.result.scannedAt);
  assert.equal(stored.loading, true);
  assert.equal(harness.nextDelay(), 5_000);
  const completedAt = "2026-10-05T00:01:00Z";
  harness.mode.payload = { ...signalsPayload, result: { ...signalsPayload.result, scannedAt: completedAt }, stale: false, refreshing: false };
  harness.runTimer(); await settlePolling();
  assert.equal(harness.render().stale, false);
  assert.equal(harness.render().loading, false);
  assert.equal(harness.render().lastUpdated, completedAt);
  assert.equal(harness.nextDelay(), 60_000);
  harness.unmount();
});

test("initial offline Signals stops the skeleton and resumes immediately when online", async () => {
  const harness = pollingHook("src/presentation/hooks/use-scanner.ts", "useDashboardSignals", signalsPayload);
  harness.navigator.onLine = false;
  harness.runTimer();
  const offline = harness.render();
  assert.equal(harness.requests.length, 0);
  assert.equal(offline.loading, false);
  assert.match(offline.error!, /offline.*Reconnect/);
  assert.equal(offline.result, null);
  offline.refresh();
  assert.equal(harness.requests.length, 0);
  harness.navigator.onLine = true;
  harness.window.dispatchEvent(new Event("online"));
  assert.equal(harness.requests.length, 1);
  await settlePolling();
  const recovered = harness.render();
  assert.ok(recovered.result);
  assert.equal(recovered.error, null);
  assert.equal(recovered.loading, false);
  harness.unmount();
});

test("hidden initial polling does not falsely report offline, but visible offline polling does", () => {
  const harness = pollingHook("src/presentation/hooks/use-scanner.ts", "useDashboardSignals", signalsPayload);
  harness.document.visibilityState = "hidden";
  harness.navigator.onLine = false;
  harness.runTimer();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.render().error, null);
  harness.document.visibilityState = "visible";
  harness.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(harness.render().loading, false);
  assert.match(harness.render().error!, /offline/);
  harness.unmount();
});

test("offline cancellation drains one in-flight read before reconnect and retains only allowed snapshots", async () => {
  for (const [path, hook, payload, retain] of [
    ["src/presentation/hooks/use-scanner.ts", "useDashboardSignals", signalsPayload, false],
    ["src/presentation/hooks/use-market-context.ts", "useMarketContext", marketPayload, true],
  ] as const) {
    const harness = pollingHook(path, hook, payload);
    harness.runTimer(); await settlePolling();
    const updated = harness.render().lastUpdated;
    harness.mode.stalled = true;
    harness.render().refresh();
    assert.equal(harness.requests.length, 2);
    harness.navigator.onLine = false;
    harness.window.dispatchEvent(new Event("offline"));
    assert.equal(harness.signals.at(-1)?.aborted, true);
    const offline = harness.render();
    assert.equal(offline.loading, false);
    assert.match(offline.error!, /offline/);
    assert.equal(offline.lastUpdated, updated);
    assert.equal(offline.stale, retain);
    assert.equal(Boolean(offline.context ?? offline.result), retain);
    harness.mode.stalled = false;
    harness.navigator.onLine = true;
    harness.window.dispatchEvent(new Event("online"));
    offline.refresh();
    assert.equal(harness.requests.length, 2, "reconnect cannot overlap the aborted request's cleanup");
    await settlePolling();
    assert.equal(harness.nextDelay(), 0);
    harness.runTimer(); await settlePolling();
    assert.equal(harness.requests.length, 3);
    assert.equal(harness.render().error, null);
    assert.equal(harness.render().stale, false);
    harness.unmount();
    const revision = harness.revision();
    harness.window.dispatchEvent(new Event("offline"));
    assert.equal(harness.revision(), revision, "unmount removes the offline listener");
  }
});

test("offline access changes cannot reuse data from the prior plan", async () => {
  const harness = pollingHook("src/presentation/hooks/use-scanner.ts", "useDashboardSignals", signalsPayload);
  harness.runTimer(); await settlePolling();
  assert.ok(harness.render().result);
  harness.navigator.onLine = false;
  harness.access.plan = "free";
  harness.access.fullAccess = false;
  assert.equal(harness.render().result, null);
  harness.window.dispatchEvent(new Event("offline"));
  const offline = harness.render();
  assert.equal(offline.result, null);
  assert.equal(offline.lastUpdated, null);
  assert.equal(offline.loading, false);
  assert.match(offline.error!, /offline/);
  harness.unmount();
});

test("market refresh is single-flight, labels a retained snapshot stale after timeout, and recovers", async () => {
  const harness = pollingHook("src/presentation/hooks/use-market-context.ts", "useMarketContext", marketPayload);
  harness.runTimer();
  await settlePolling();
  assert.ok(harness.render().context);
  harness.mode.stalled = true;
  harness.render().refresh();
  harness.render().refresh();
  assert.equal(harness.requests.length, 2, "refresh stays single-flight");
  harness.timeout();
  await settlePolling();
  const failed = harness.render();
  assert.ok(failed.context);
  assert.ok(failed.sentiment);
  assert.equal(failed.stale, true);
  assert.equal(failed.lastUpdated, marketPayload.fetchedAt);
  assert.match(failed.error!, /timed out/);
  assert.equal(failed.loading, false);
  harness.mode.stalled = false;
  failed.refresh();
  await settlePolling();
  assert.equal(harness.render().stale, false);
  assert.equal(harness.render().error, null);
  assert.ok(harness.requests.every((request) => request.url === "/api/market-context"));
  assert.ok(harness.budgets.every((budget) => budget === 12000));
  harness.mode.stalled = true;
  harness.render().refresh();
  const revision = harness.revision();
  harness.unmount();
  assert.equal(harness.signals.at(-1)?.aborted, true);
  await settlePolling();
  assert.equal(harness.revision(), revision, "cancelled work must not write state after unmount");
});

test("signals wait is bounded, clears setups after failure, and cancels on unmount", async () => {
  const harness = pollingHook("src/presentation/hooks/use-scanner.ts", "useDashboardSignals", signalsPayload);
  harness.runTimer();
  await settlePolling();
  assert.ok(harness.render().result);
  harness.mode.stalled = true;
  harness.render().refresh();
  harness.render().refresh();
  assert.equal(harness.requests.length, 2);
  harness.timeout();
  await settlePolling();
  const failed = harness.render();
  assert.equal(failed.result, null);
  assert.equal(failed.top?.length, 0);
  assert.equal(failed.stale, false);
  assert.equal(failed.lastUpdated, signalsPayload.result.scannedAt);
  assert.equal(failed.loading, false);
  assert.match(failed.error!, /timed out/);
  failed.refresh();
  const revision = harness.revision();
  harness.unmount();
  assert.equal(harness.signals.at(-1)?.aborted, true);
  await settlePolling();
  assert.equal(harness.revision(), revision);
  assert.ok(harness.budgets.every((budget) => budget === 90000));
  assert.equal(JSON.parse(harness.requests[0].body!).limit, 5);
});

test("polling resumes immediately on visible and online events without piling requests", async () => {
  const harness = pollingHook("src/presentation/hooks/use-market-context.ts", "useMarketContext", marketPayload);
  harness.document.visibilityState = "hidden";
  harness.runTimer();
  assert.equal(harness.requests.length, 0);
  harness.document.visibilityState = "visible";
  harness.mode.stalled = true;
  harness.document.dispatchEvent(new Event("visibilitychange"));
  harness.window.dispatchEvent(new Event("online"));
  harness.render().refresh();
  assert.equal(harness.requests.length, 1);
  harness.timeout();
  await settlePolling();
  harness.navigator.onLine = false;
  harness.runTimer();
  assert.equal(harness.requests.length, 1);
  harness.mode.stalled = false;
  harness.navigator.onLine = true;
  harness.window.dispatchEvent(new Event("online"));
  await settlePolling();
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.render().error, null);
  harness.unmount();
});

test("transient retries back off, stop rapid retries, and never expose raw network errors", async () => {
  const harness = pollingHook("src/presentation/hooks/use-market-context.ts", "useMarketContext", marketPayload);
  harness.mode.failure = new TypeError("Load failed: private-canary");
  for (const delay of [2000, 4000, 8000, 30000]) {
    harness.runTimer();
    await settlePolling();
    const failed = harness.render();
    assert.equal(failed.context, null);
    assert.equal(failed.lastUpdated, null);
    assert.equal(failed.stale, false);
    assert.match(failed.error!, /Check your connection/);
    assert.equal(failed.error!.includes("private-canary"), false);
    assert.equal(harness.nextDelay(), delay);
  }
  harness.unmount();
});

test("Retry-After blocks automatic, manual, and resume reads until its deadline", async () => {
  const harness = pollingHook("src/presentation/hooks/use-market-context.ts", "useMarketContext", marketPayload);
  harness.mode.status = 429;
  harness.mode.retryAfter = "120";
  harness.runTimer();
  await settlePolling();
  assert.equal(harness.nextDelay(), 120000);
  harness.render().refresh();
  harness.window.dispatchEvent(new Event("online"));
  harness.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(harness.requests.length, 1);
  harness.clock.now += 119000;
  harness.runTimer();
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.nextDelay(), 1000);
  harness.clock.now += 1000;
  harness.mode.status = 200;
  harness.runTimer();
  await settlePolling();
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.render().error, null);
  harness.unmount();
});

test("scan access changes hide old data immediately and abort prior access reads", async () => {
  const harness = pollingHook("src/presentation/hooks/use-scanner.ts", "useDashboardSignals", signalsPayload);
  harness.runTimer();
  await settlePolling();
  assert.ok(harness.render().result);
  harness.mode.stalled = true;
  harness.render().refresh();
  harness.access.plan = "free";
  harness.access.fullAccess = false;
  const changed = harness.render();
  assert.equal(changed.result, null);
  assert.equal(changed.lastUpdated, null);
  assert.equal(changed.loading, true);
  assert.equal(harness.signals.at(-1)?.aborted, true);
  await settlePolling();
  harness.mode.stalled = false;
  harness.mode.payload = { ...signalsPayload, result: { ...signalsPayload.result, demand: [] } };
  harness.runTimer();
  await settlePolling();
  assert.ok(harness.render().result);
  harness.window.dispatchEvent(new Event("coinsecret:auth-state-changed"));
  assert.equal(harness.render().result, null, "a same-plan account switch must invalidate the old snapshot");
  assert.equal(harness.render().lastUpdated, null);
  harness.unmount();
});

test("disabling polling hides prior data and busy state and prevents manual requests", async () => {
  for (const [path, hook, payload] of [
    ["src/presentation/hooks/use-scanner.ts", "useSdScan", signalsPayload],
    ["src/presentation/hooks/use-market-context.ts", "useMarketContext", marketPayload],
  ] as const) {
    const harness = pollingHook(path, hook, payload);
    harness.runTimer();
    await settlePolling();
    harness.mode.stalled = true;
    harness.render().refresh();
    const calls = harness.requests.length;
    const disabled = harness.render(false);
    assert.equal(disabled.loading, false);
    assert.equal("result" in disabled ? disabled.result : disabled.context, null);
    disabled.refresh();
    assert.equal(harness.requests.length, calls);
    assert.equal(harness.signals.at(-1)?.aborted, true);
    harness.unmount();
  }
});

test("invalid successful response is unavailable and does not fabricate an empty market", async () => {
  const harness = pollingHook("src/presentation/hooks/use-market-context.ts", "useMarketContext", {});
  harness.runTimer();
  await settlePolling();
  assert.equal(harness.render().context, null);
  assert.match(harness.render().error!, /unreadable response/);
  assert.equal(harness.render().lastUpdated, null);
  harness.unmount();
});

test("read failure helpers parse HTTP dates and keep permanent access faults out of retries", () => {
  assert.equal(readFailures.retryAfterMs("2", 1000), 2000);
  assert.equal(readFailures.retryAfterMs("Thu, 01 Jan 1970 00:00:04 GMT", 1000), 3000);
  assert.equal(readFailures.retryAfterMs("invalid", 1000), 0);
  assert.equal(readFailures.retryAfterMs("-2", 1000), 0);
  assert.equal(readFailures.responseReadFailure(403, "Signals", null).retryable, false);
  assert.equal(readFailures.responseReadFailure(400, "Signals", null).retryable, false);
  assert.equal(readFailures.responseReadFailure(503, "Signals", null).retryable, true);
  assert.equal(readFailures.responseReadFailure(429, "Signals", null).retryAfterMs, 60000);
  assert.match(readFailures.normalizeReadFailure(new SyntaxError("private-canary"), "Signals").message, /unreadable/);
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
    "@/presentation/hooks/use-translate": { useT: () => ({ t: (key: string) => key }) },
  };
  for (const [module, name] of [
    ["features/analysis/analysis-view", "AnalysisView"], ["features/dashboard/market-overview", "MarketOverview"],
    ["features/analysis/chart-data-status", "ChartDataStatus"],
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { parseScanSymbols } from "@/core/application/scanner/scan-request";
import { visibleSignalsFor } from "@/core/domain/analysis/signal-display";

function routeFixture(options: { failure?: Error; errors?: string[]; allowed?: boolean; stale?: boolean; refreshing?: boolean; fullAccess?: boolean; hits?: Array<{ confidence: number }> } = {}) {
  const diagnostics: unknown[][] = [];
  const scans: unknown[][] = [];
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    "next/server": { after: () => undefined },
    "@/config/default-watchlist": { DEFAULT_WATCHLIST: ["BTCUSDT", "ETHUSDT"] },
    "@/core/application/rate-limit/fixed-window": { createFixedWindowLimiter: () => ({ check: () => ({ allowed: options.allowed !== false, retryAfterSeconds: 10 }) }) },
    "@/core/application/scanner/scan-request": { parseScanSymbols },
    "@/core/application/scanner/supply-demand-scan-service": {
      rankTopSetups: () => [],
    },
    "@/core/application/scanner/published-board-service": {
      readPublishedBoard: async (input: { marketData: unknown; symbols: string[]; force: boolean }) => {
        scans.push([input.marketData, input.symbols, input.force]);
        if (options.failure) throw options.failure;
        return { result: { demand: options.hits ?? [], supply: [], market: [], demandTotal: options.hits?.length ?? 0, supplyTotal: 0, scannedAt: new Date(0).toISOString(), errors: options.errors ?? [] }, stale: options.stale ?? false, refreshing: options.refreshing ?? false };
      },
    },
    "@/core/domain/analysis/signal-display": { visibleSignalsFor },
    "@/infrastructure/persistence/active-setup-store": { activeSetupStore: {} },
    "@/infrastructure/persistence/signals-snapshot-store": { signalsSnapshotStore: {} },
    "@/infrastructure/market-data/market-data-provider": { marketData: {} },
    "@/infrastructure/auth/current-user": { getCurrentUser: async () => ({ id: "private-user-canary" }) },
    "@/infrastructure/auth/entitlements": { canUserAccessFeature: async () => options.fullAccess ?? false },
    "@/shared/server/http": { getRequestIp: () => "private-ip-canary", tooManyRequests: () => Response.json({ error: "Rate limited" }, { status: 429, headers: { "Retry-After": "10" } }) },
  };
  runInNewContext(ts.transpileModule(readFileSync("src/app/api/signals/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Response, Error, performance,
    console: { info: (...args: unknown[]) => diagnostics.push(args), warn: (...args: unknown[]) => diagnostics.push(args), error: (...args: unknown[]) => diagnostics.push(args) },
    require: (name: string) => dependencies[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
  });
  return { post: exports.POST!, diagnostics, scans };
}

function request(body: unknown) {
  return new Request("https://coin-secret.invalid/api/signals", { method: "POST", body: JSON.stringify(body) });
}

function assertDiagnostic(diagnostics: unknown[][], status: number, symbolCount: number, failureCount: number) {
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][0], "[signals.request]");
  const detail = diagnostics[0][1] as { status: number; elapsedMs: number; symbolCount: number; failureCount: number };
  assert.deepEqual(Object.keys(detail).sort(), ["elapsedMs", "failureCount", "status", "symbolCount"]);
  assert.equal(detail.status, status);
  assert.equal(detail.symbolCount, symbolCount);
  assert.equal(detail.failureCount, failureCount);
  assert.ok(Number.isInteger(detail.elapsedMs) && detail.elapsedMs >= 0);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-.*-canary/);
}

test("signals diagnostics report successful and partial scans without widening the custom free board", async () => {
  for (const errors of [[], ["BTCUSDT: provider unavailable"]]) {
    const fixture = routeFixture({ errors });
    const symbols = Array.from({ length: 30 }, (_, index) => `COIN${index}USDT`);
    const response = await fixture.post(request({ symbols, force: true }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((fixture.scans[0][1] as string[]).length, 20);
    assert.equal(fixture.scans[0][2], true);
    assertDiagnostic(fixture.diagnostics, 200, 20, errors.length);
  }
});

test("signals failures remain unavailable, uncached, and log no exception details", async () => {
  const fixture = routeFixture({ failure: new Error("private-database-canary", { cause: "private-credentials-canary" }) });
  const response = await fixture.post(request({}));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "Signals unavailable" });
  assertDiagnostic(fixture.diagnostics, 503, 2, 1);
});

test("stored raw boards preserve scan time and reapply access on every response", async () => {
  const options = { hits: Array.from({ length: 6 }, () => ({ confidence: 80 })), fullAccess: true, stale: true, refreshing: true };
  const fixture = routeFixture(options);
  const pro = await (await fixture.post(request({}))).json();
  assert.equal(pro.result.demand.length, 6);
  assert.equal(pro.result.scannedAt, new Date(0).toISOString());
  assert.equal(pro.stale, true);
  assert.equal(pro.refreshing, true);
  options.fullAccess = false;
  const free = await (await fixture.post(request({}))).json();
  assert.equal(free.result.demand.length, 3, "cached Pro results cannot bypass current access");
  assert.equal(free.result.demandTotal, 6);
});

test("signals diagnostics cover validation and rate limiting without starting a scan", async () => {
  const invalid = routeFixture();
  const invalidResponse = await invalid.post(request({ symbols: [] }));
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(invalid.scans.length, 0);
  assertDiagnostic(invalid.diagnostics, 400, 0, 1);

  const limited = routeFixture({ allowed: false });
  const limitedResponse = await limited.post(request({}));
  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers.get("retry-after"), "10");
  assert.equal(limitedResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(limited.scans.length, 0);
  assertDiagnostic(limited.diagnostics, 429, 0, 1);
});

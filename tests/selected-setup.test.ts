import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import * as signatures from "@/core/domain/analysis/setup-signature";
import * as lifecycle from "@/core/domain/analysis/setup-lifecycle";
import * as supplyDemand from "@/core/domain/analysis/supply-demand";
import * as timeframe from "@/core/domain/market/timeframe";
import * as exchange from "@/core/domain/market/exchange";
import { mapConcurrent } from "@/shared/lib/async";

function source(path: string, modules: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Request, Response, URL, AbortSignal, Date, console, require: (name: string) => modules[name] ?? {} });
  return exports;
}
class HttpError extends Error { constructor(public status: number, message: string, public code = "REQUEST_ERROR") { super(message); } }
const symbol = "HYPEUSDT";
const signature = "HYPEUSDT|15m|long|1795437000";
const selected = { symbol, timeframe: "15m", direction: "long", entry: 64.0275, target1: 64.67594, target2: 65.32438,
  stopLoss: 63.37905, confidence: 74, zoneTop: 64.0275, zoneBottom: 63.5, zoneBaseTime: 1795437000, status: "Missed", exchange: "binance" };

test("a selected cancelled screener setup is read by exact identity instead of replaced by the current symbol plan", async () => {
  const calls: string[] = [];
  const api = source("src/app/api/setup/route.ts", {
    "@/core/domain/market/symbol": { normalizeUsdtSymbol: (value: string) => value.toUpperCase() },
    "@/core/domain/analysis/setup-signature": signatures,
    "@/infrastructure/persistence/active-setup-store": { activeSetupStore: {
      loadActive: async () => { calls.push("active"); return [{ ...selected, status: "Running", entry: 99 }]; },
      loadPublished: async (requested: string, key: string) => { calls.push(`${requested}:${key}`); return key === signature ? selected : null; },
    } },
    "@/shared/server/http": { HttpError, apiError: (error: HttpError) => Response.json({ error: error.code }, { status: error.status }) },
  }).GET as (request: Request) => Promise<Response>;
  const response = await api(new Request(`https://coinsecret.io/api/setup?symbol=${symbol}&signature=${encodeURIComponent(signature)}`));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).setup, selected);
  assert.deepEqual(calls, [`${symbol}:${signature}`]);
  const missing = await api(new Request(`https://coinsecret.io/api/setup?symbol=${symbol}&signature=${encodeURIComponent("HYPEUSDT|15m|long|1795437001")}`));
  assert.equal((await missing.json()).setup, null);
  for (const invalid of ["", "BTCUSDT|15m|long|1795437000", "HYPEUSDT|wat|long|1795437000", "HYPEUSDT|15m|long|-1", "HYPEUSDT|15m|long|01", "x".repeat(161)]) {
    assert.equal((await api(new Request(`https://coinsecret.io/api/setup?symbol=${symbol}&signature=${encodeURIComponent(invalid)}`))).status, 400, invalid);
  }
  const ordinary = await api(new Request(`https://coinsecret.io/api/setup?symbol=${symbol}`));
  assert.equal((await ordinary.json()).setup.entry, 99);
});

test("identity lookup reads the exact published row from the isolated read pool, including its terminal status", async () => {
  const publication = new Date("2026-11-23T13:30:06.344Z");
  const row = { ...selected, signature, firstSeenAt: publication, archivedAt: null };
  let archived = false;
  let where: unknown;
  let reads = 0;
  const database = { trackedSetup: { findFirst: () => { throw new Error("wrong pool"); } } };
  const readDatabase = { trackedSetup: { findFirst: async (input: { where: { symbol: string; signature: string; archivedAt: null } }) => {
    where = input.where;
    return input.where.signature === signature && input.where.symbol === symbol && !archived ? row : null;
  } } };
  const storeModule = source("src/infrastructure/persistence/active-setup-store.ts", {
    "server-only": {}, "@/infrastructure/database/prisma": { prisma: database, marketReadPrisma: readDatabase },
    "@/core/domain/analysis/setup-lifecycle": lifecycle,
    "@/core/domain/analysis/supply-demand": supplyDemand,
    "@/core/domain/market/timeframe": timeframe,
    "@/core/domain/market/exchange": exchange,
    "@/core/domain/analysis/setup-signature": signatures,
    "@/shared/lib/async": { mapConcurrent },
    "@/infrastructure/database/setup-read": { readSetupRows: async (_read: string, work: () => Promise<unknown>, signal?: AbortSignal) => {
      reads++; signal?.throwIfAborted(); return work();
    } },
  });
  const store = storeModule.activeSetupStore as ActiveSetupPort;
  assert.ok(store.loadPublished);
  const result = await store.loadPublished(symbol, signature, AbortSignal.timeout(1000));
  assert.equal(result?.entry, selected.entry);
  assert.equal(result?.status, "Missed");
  assert.equal(result?.publishedAt, publication.getTime() / 1000);
  assert.deepEqual(JSON.parse(JSON.stringify(where)), { symbol, signature, archivedAt: null });
  assert.equal(reads, 1);
  assert.equal(await store.loadPublished(symbol, "HYPEUSDT|15m|long|1795437001"), null);
  archived = true;
  assert.equal(await store.loadPublished(symbol, signature), null, "archived publications remain hidden");
});

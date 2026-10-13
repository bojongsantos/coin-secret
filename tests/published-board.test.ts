import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import type { SignalsSnapshot, SignalsSnapshotPort } from "@/core/application/ports/signals-snapshot-port";
import { createPublishedBoardReader } from "@/core/application/scanner/published-board-service";
import type { SdScanHit, SdScanResult } from "@/core/application/scanner/supply-demand-scan-service";
import { visibleSignalsFor } from "@/core/domain/analysis/signal-display";
import { sourcesForMarketData } from "@/core/application/market-data/source-selection";
import { ACTIVE_SETUP_STATUSES } from "@/core/domain/analysis/supply-demand";
import { setupSignature } from "@/core/domain/analysis/setup-signature";
import { createScanCache } from "@/core/application/scanner/scan-cache";

const NOW = Date.parse("2026-10-11T05:00:00.000Z");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function board(scannedAt = NOW - 90_000): SdScanResult {
  const hit = (symbol: string): SdScanHit => ({
    symbol, exchange: "binance", base: symbol.replace("USDT", ""), timeframe: "1H",
    zoneType: "demand", strength: "tested", confidence: 75, direction: "long",
    entry: 100, target1: 110, target2: 120, stopLoss: 90,
    zoneBaseTime: NOW / 1000 - 3600, zoneTop: 101, zoneBottom: 99,
    change24h: 1, volume24h: 1000, zones: 1, status: "Limit Order",
  });
  return {
    demand: DEFAULT_WATCHLIST.slice(0, 5).map(hit), supply: [], demandTotal: 5, supplyTotal: 0,
    market: DEFAULT_WATCHLIST.map((symbol) => ({
      symbol, exchange: "binance", price: 100, change24h: 1, volume24h: 1000, sparkline: [99, 100],
    })),
    scannedAt: new Date(scannedAt).toISOString(), errors: [],
  };
}
function fixture(result = board()) {
  const marketData: MarketDataPort = {
    fetchKlines: async () => [], fetchTicker24h: async () => { throw new Error("not used"); },
    fetchTickers24h: async () => [],
  };
  marketData.sources = [{ exchange: "binance", marketData }];
  let active: ActiveSetup[] = [...result.demand, ...result.supply];
  let stored: unknown = { version: 1, symbols: [...DEFAULT_WATCHLIST], sources: ["binance"], result };
  let saves = 0;
  const activeSetups: ActiveSetupPort = {
    loadActive: async () => active, loadRetiredZones: async () => [], persist: async () => {},
  };
  const snapshots: SignalsSnapshotPort = {
    load: async () => stored,
    save: async (snapshot) => { stored = snapshot; saves += 1; },
  };
  const callbacks: (() => Promise<void>)[] = [];
  const input = {
    marketData, symbols: DEFAULT_WATCHLIST, activeSetups, snapshots,
    scheduleAfter: (work: () => Promise<void>) => { callbacks.push(work); },
  };
  return {
    input, callbacks, result, snapshots, activeSetups,
    active: (rows: ActiveSetup[]) => { active = rows; },
    stored: (value: unknown) => { stored = value; },
    saved: () => saves,
    snapshot: () => stored as SignalsSnapshot,
  };
}

test("a durable board returns before refresh starts, preserves its real timestamp and awaits all refresh writes", async () => {
  const f = fixture();
  const nextScan = deferred<SdScanResult>();
  const write = deferred<void>();
  let calls = 0;
  f.snapshots.save = async () => { await write.promise; };
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async (_data, _symbols, force) => {
    assert.equal(force, true);
    calls += 1;
    return nextScan.promise;
  } });
  const old = await reader.read(f.input);
  assert.equal(calls, 0, "market work must start after the response");
  assert.equal(old.result.scannedAt, f.result.scannedAt);
  assert.equal(old.stale, true);
  assert.equal(old.refreshing, true);
  assert.equal(f.callbacks.length, 1);
  await reader.read(f.input);
  assert.equal(f.callbacks.length, 1, "concurrent callers must not schedule duplicate refreshes");
  let completed = false;
  const work = f.callbacks[0]().then(() => { completed = true; });
  nextScan.resolve(board(NOW));
  await new Promise((done) => setImmediate(done));
  assert.equal(completed, false, "platform callback must await persistence");
  const latest = await reader.read(f.input);
  assert.equal(latest.result.scannedAt, new Date(NOW).toISOString());
  assert.equal(latest.stale, false);
  assert.equal(latest.refreshing, true);
  write.resolve();
  await work;
  assert.equal((await reader.read(f.input)).refreshing, false);
});

test("current published rows remove archived, terminal, replaced and changed-source plans; committed status is overlaid", async () => {
  const f = fixture(board(NOW));
  const hits = f.result.demand;
  f.active([
    { ...hits[1], status: "Target 2 reached" },
    { ...hits[2], zoneBaseTime: hits[2].zoneBaseTime + 3600 },
    { ...hits[3], exchange: "bybit" },
    { ...hits[4], status: "Running" },
  ]);
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => board(NOW) });
  const response = await reader.read(f.input);
  assert.deepEqual(response.result.demand.map((hit) => [hit.symbol, hit.status]), [[hits[4].symbol, "Running"]]);
  assert.equal(response.result.demandTotal, 1);
  assert.equal(response.stale, true);
  assert.equal(response.refreshing, true);
  f.active([{ ...hits[4], entry: hits[4].entry + 1 }]);
  assert.equal((await reader.read(f.input)).result.demandTotal, 0, "frozen level mismatch must also be hidden");
});

test("access is applied for every request to the unfiltered shared board", async () => {
  const f = fixture(board(NOW));
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => board(NOW) });
  const result = (await reader.read(f.input)).result;
  assert.equal(visibleSignalsFor(result, true).demand.length, 5);
  assert.equal(visibleSignalsFor(result, false).demand.length, 3);
  assert.equal((await reader.read(f.input)).result.demand.length, 5);
  assert.equal(f.callbacks.length, 0);
});

test("failed and partial background refreshes keep the original board and use a short retry backoff", async () => {
  let clock = NOW;
  const f = fixture();
  let calls = 0;
  const reader = createPublishedBoardReader({ now: () => clock, scan: async () => {
    calls += 1;
    if (calls === 1) throw new Error("provider failed");
    return { ...board(clock), errors: ["BTCUSDT: candles unavailable"] };
  } });
  await reader.read(f.input);
  await f.callbacks[0]();
  const afterFailure = await reader.read(f.input);
  assert.equal(afterFailure.result.scannedAt, f.result.scannedAt);
  assert.equal(afterFailure.stale, true);
  assert.equal(afterFailure.refreshing, false);
  assert.equal(f.callbacks.length, 1);
  clock += 15_000;
  await reader.read(f.input);
  await f.callbacks[1]();
  assert.equal(f.saved(), 0);
  assert.equal(f.snapshot().result.scannedAt, f.result.scannedAt);
});

test("expired, malformed, wrong-watchlist, unknown-source and source-configuration snapshots cannot serve as a current board", async () => {
  for (const corrupt of [
    (f: ReturnType<typeof fixture>) => f.stored({ ...f.snapshot(), result: board(NOW - 3_600_001) }),
    (f: ReturnType<typeof fixture>) => f.stored({ ...f.snapshot(), result: board(NOW + 1) }),
    (f: ReturnType<typeof fixture>) => f.stored({ ...f.snapshot(), version: 0 }),
    (f: ReturnType<typeof fixture>) => f.stored({ ...f.snapshot(), symbols: ["BTCUSDT"] }),
    (f: ReturnType<typeof fixture>) => f.stored({ ...f.snapshot(), result: { ...f.result, demand: [{ ...f.result.demand[0], exchange: null }] } }),
    (f: ReturnType<typeof fixture>) => { f.input.marketData.sources = [{ exchange: "bybit", marketData: f.input.marketData }]; },
  ]) {
    const f = fixture();
    corrupt(f);
    let calls = 0;
    const live = board(NOW);
    const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => { calls += 1; return live; } });
    const response = await reader.read(f.input);
    assert.deepEqual(response.result, live);
    assert.equal(response.stale, false);
    assert.equal(calls, 1);
    assert.equal(f.callbacks.length, 0);
  }
});

test("custom symbol scans bypass the default snapshot and retain the caller's force policy", async () => {
  const f = fixture();
  let reads = 0;
  f.snapshots.load = async () => { reads += 1; throw new Error("unused"); };
  const reader = createPublishedBoardReader({ scan: async (_data, symbols, force) => {
    assert.deepEqual(symbols, ["BTCUSDT"]);
    assert.equal(force, false);
    return board();
  } });
  await reader.read({ ...f.input, symbols: ["BTCUSDT"] });
  assert.equal(reads, 0);
  assert.equal(f.saved(), 0);
  assert.equal(f.callbacks.length, 0);
});

test("a board from ten minutes ago displays its last verification immediately and refreshes after the response", async () => {
  const f = fixture(board(NOW - 10 * 60_000));
  let calls = 0;
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => { calls += 1; return board(NOW); } });
  const response = await reader.read(f.input);
  assert.equal(response.result.scannedAt, f.result.scannedAt);
  assert.equal(response.stale, true);
  assert.equal(response.refreshing, true);
  assert.equal(calls, 0);
  await f.callbacks[0]();
  assert.equal(calls, 1);
});

test("a successful scan remains available in memory when durable publication fails, but active validation still fails closed", async () => {
  const f = fixture();
  f.stored(null);
  f.snapshots.save = async () => { throw new Error("database temporarily unavailable"); };
  let calls = 0;
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => { calls += 1; return board(NOW); } });
  assert.equal((await reader.read(f.input)).snapshotPublished, false);
  assert.equal((await reader.read(f.input)).result.scannedAt, new Date(NOW).toISOString());
  assert.equal(calls, 1);
  f.activeSetups.loadActive = async () => { throw new Error("active read unavailable"); };
  await assert.rejects(reader.read(f.input), /active read unavailable/);
});

test("a successful refresh after clock rollback replaces the future memory board and the next read stays fast", async () => {
  const f = fixture(board(NOW));
  let clock = NOW;
  let calls = 0;
  const reader = createPublishedBoardReader({ now: () => clock, scan: async () => {
    calls += 1;
    return board(clock);
  } });
  await reader.refresh(f.input);
  assert.equal(calls, 1);
  clock -= 2 * 60_000;
  const refreshed = await reader.read(f.input);
  assert.equal(refreshed.result.scannedAt, new Date(clock).toISOString());
  assert.equal(calls, 2, "a future memory board requires one truthful scan after rollback");
  const cached = await reader.read(f.input);
  assert.equal(cached.result.scannedAt, refreshed.result.scannedAt);
  assert.equal(cached.stale, false);
  assert.equal(cached.refreshing, false);
  assert.equal(calls, 2, "the rejected future timestamp must not poison subsequent reads");
  assert.equal(f.callbacks.length, 0);
});

test("stale and expired memory consult a newer shared board before attempting another market scan", async () => {
  for (const elapsed of [90_000, 61 * 60_000]) {
    const f = fixture(board(NOW));
    let clock = NOW;
    let calls = 0;
    let reads = 0;
    const reader = createPublishedBoardReader({ now: () => clock, scan: async () => {
      if (++calls > 1) throw new Error("provider unavailable");
      return board(clock);
    } });
    await reader.refresh(f.input);
    clock += elapsed;
    const shared = { ...f.snapshot(), result: board(clock) };
    f.snapshots.load = async () => { reads += 1; return shared; };
    const response = await reader.read(f.input);
    assert.equal(response.result.scannedAt, shared.result.scannedAt);
    assert.equal(response.stale, false);
    assert.equal(response.refreshing, false);
    assert.equal(calls, 1, "an available shared board must avoid an unnecessary failing full scan");
    assert.equal(reads, 1);
    await reader.read(f.input);
    assert.equal(reads, 1, "the newer shared board becomes the fresh local fast path");
    assert.equal(calls, 1);
  }
});

test("a failed shared snapshot read retains only usable local memory and keeps its original stale timestamp", async () => {
  const f = fixture(board(NOW));
  let clock = NOW;
  let calls = 0;
  const reader = createPublishedBoardReader({ now: () => clock, scan: async () => {
    if (++calls > 1) throw new Error("provider unavailable");
    return board(clock);
  } });
  await reader.refresh(f.input);
  f.snapshots.load = async () => { throw new Error("shared store unavailable"); };
  clock += 90_000;
  const stale = await reader.read(f.input);
  assert.equal(stale.result.scannedAt, new Date(NOW).toISOString());
  assert.equal(stale.stale, true);
  assert.equal(stale.refreshing, true);
  assert.equal(calls, 1);
  await f.callbacks[0]();
  clock += 61 * 60_000;
  await assert.rejects(reader.read(f.input), /provider unavailable/);
  assert.equal(calls, 3, "expired memory cannot be served when both the shared store and provider fail");
});

test("published metadata gives the actual narrow read helper room for a native connection timeout and one retry", async () => {
  let elapsed = 0;
  const budgets: number[] = [];
  const waits: number[] = [];
  const diagnostics: unknown[][] = [];
  const signalFor = (budget: number) => ({
    get aborted() { return elapsed >= budget; },
    throwIfAborted() { if (elapsed >= budget) throw new DOMException("Metadata deadline exceeded", "TimeoutError"); },
  }) as AbortSignal;
  class HttpError extends Error {
    constructor(public status: number, message: string, public code: string) { super(message); }
  }
  const helper: { readSetupRows?: <T>(read: "active", work: () => Promise<T>, signal?: AbortSignal) => Promise<T> } = {};
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/database/setup-read.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: helper,
    performance,
    console: { warn: (...args: unknown[]) => diagnostics.push(args) },
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name === "@/shared/server/http") return { HttpError };
      if (name === "node:timers/promises") return { setTimeout: async (ms: number) => { waits.push(ms); elapsed += ms; } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const service: { createPublishedBoardReader?: typeof createPublishedBoardReader } = {};
  const dependencies: Record<string, unknown> = {
    zod: { z },
    "@/config/default-watchlist": { DEFAULT_WATCHLIST },
    "@/core/application/market-data/source-selection": { sourcesForMarketData },
    "@/core/domain/analysis/supply-demand": { ACTIVE_SETUP_STATUSES },
    "@/core/domain/analysis/setup-signature": { setupSignature },
    "@/core/application/scanner/supply-demand-scan-service": { runSdScanCached: async () => { throw new Error("unexpected market scan"); } },
    "@/core/application/scanner/scan-cache": { createScanCache },
  };
  runInNewContext(ts.transpileModule(readFileSync("src/core/application/scanner/published-board-service.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: service,
    console,
    AbortSignal: { timeout: (budget: number) => { budgets.push(budget); return signalFor(budget); } },
    require: (name: string) => dependencies[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
  });
  const f = fixture(board(NOW));
  let attempts = 0;
  f.activeSetups.loadActive = async (_symbols, signal) => helper.readSetupRows!("active", async () => {
    elapsed += 10_000;
    if (++attempts === 1) throw new Error("Connection terminated due to connection timeout");
    return f.result.demand;
  }, signal);
  const reader = service.createPublishedBoardReader!({ now: () => NOW + elapsed });
  const response = await reader.read(f.input);
  assert.deepEqual(budgets, [25_000]);
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [200]);
  assert.equal(elapsed, 20_200);
  assert.equal(diagnostics.length, 1);
  assert.equal((diagnostics[0][1] as { retrying: boolean }).retrying, true);
  assert.equal(response.stale, false);
  assert.equal(response.result.demand.length, 5);
});

test("first-load and after work share the whole refresh through its write completion", async () => {
  const f = fixture();
  let clock = NOW;
  let calls = 0;
  const nextScan = deferred<SdScanResult>();
  const reader = createPublishedBoardReader({ now: () => clock, scan: async () => { calls += 1; return nextScan.promise; } });
  await reader.read(f.input);
  const background = f.callbacks[0]();
  f.stored(null);
  clock += 61 * 60_000;
  const cold = reader.read(f.input);
  nextScan.resolve(board(clock));
  await Promise.all([background, cold]);
  assert.equal(calls, 1);
  assert.equal(f.saved(), 1);
});

test("two process readers share fenced refresh ownership and a contender reuses the durable board", async () => {
  const f = fixture();
  const gate = deferred<SdScanResult>();
  let held = false;
  let calls = 0;
  const transactionStore: ActiveSetupPort = { ...f.activeSetups };
  f.snapshots.coordinateRefresh = async (work) => {
    if (held) return { acquired: false };
    held = true;
    try { return { acquired: true, value: await work(transactionStore) }; }
    finally { held = false; }
  };
  const scan = async (_data: MarketDataPort, _symbols: string[], _force: boolean | undefined,
    options: { activeSetups?: ActiveSetupPort } = {}) => {
    calls += 1;
    assert.equal(options.activeSetups, transactionStore, "all publication writes must use the fenced store");
    return gate.promise;
  };
  const owner = createPublishedBoardReader({ now: () => NOW, scan });
  const contender = createPublishedBoardReader({ now: () => NOW, scan });
  const first = owner.refresh(f.input);
  const second = await contender.refresh(f.input);
  assert.equal(second.result.scannedAt, f.result.scannedAt);
  assert.equal(second.stale, true);
  assert.equal(second.refreshing, true);
  assert.equal(second.snapshotPublished, false);
  assert.equal(calls, 1);
  gate.resolve(board(NOW));
  assert.equal((await first).snapshotPublished, true);
  assert.equal((await contender.read(f.input)).result.scannedAt, new Date(NOW).toISOString());
});

test("a cold contender with no usable board never starts an unfenced duplicate scan", async () => {
  const f = fixture();
  f.stored(null);
  f.snapshots.coordinateRefresh = async () => ({ acquired: false });
  let calls = 0;
  const reader = createPublishedBoardReader({ scan: async () => { calls += 1; return board(NOW); } });
  await assert.rejects(reader.read(f.input), /refresh already in progress/);
  assert.equal(calls, 0);
  assert.equal(f.saved(), 0);
});

test("a transaction must commit before fresh memory or a durable snapshot can be published", async () => {
  const f = fixture();
  const commit = deferred<void>();
  let scanned = false;
  f.snapshots.coordinateRefresh = async (work) => {
    const value = await work(f.activeSetups);
    scanned = true;
    await commit.promise;
    return { acquired: true, value };
  };
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => board(NOW) });
  const pending = reader.refresh(f.input);
  await new Promise((done) => setImmediate(done));
  assert.equal(scanned, true);
  assert.equal(f.saved(), 0);
  assert.equal((await reader.read(f.input)).result.scannedAt, f.result.scannedAt);
  commit.resolve();
  assert.equal((await pending).snapshotPublished, true);
  assert.equal(f.saved(), 1);
  assert.equal((await reader.read(f.input)).result.scannedAt, new Date(NOW).toISOString());
});

test("a rollback cannot publish its scan result into memory or durable storage", async () => {
  const f = fixture();
  f.snapshots.coordinateRefresh = async (work) => {
    await work(f.activeSetups);
    throw new Error("transaction rolled back");
  };
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => board(NOW) });
  await assert.rejects(reader.refresh(f.input), /transaction rolled back/);
  assert.equal(f.saved(), 0);
  const retained = await reader.read(f.input);
  assert.equal(retained.result.scannedAt, f.result.scannedAt);
  assert.equal(retained.stale, true);
});

test("a row finished by capture during scan persistence is absent from the refreshed response and snapshot", async () => {
  const f = fixture();
  const terminal = f.result.demand[0];
  f.snapshots.coordinateRefresh = async (work) => {
    const value = await work(f.activeSetups);
    // The real adapter skips the scan update once another writer has made this row terminal.
    f.active([{ ...terminal, status: "Target 2 reached" }, ...f.result.demand.slice(1)]);
    return { acquired: true, value };
  };
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => board(NOW) });
  const refreshed = await reader.refresh(f.input);
  assert.equal(refreshed.result.demandTotal, 4);
  assert.ok(refreshed.result.demand.every((hit) => hit.symbol !== terminal.symbol));
  assert.equal(f.snapshot().result.demandTotal, 4);
  assert.ok(f.snapshot().result.demand.every((hit) => hit.symbol !== terminal.symbol));
});

test("a capture advancing a row to Target 1 during a scan overrides the stale Running result after commit", async () => {
  const raw = board(NOW);
  raw.demand[0].status = "Running";
  const f = fixture(raw);
  f.snapshots.coordinateRefresh = async (work) => {
    const value = await work(f.activeSetups);
    // The fenced adapter loses its version CAS; capture's committed status remains authoritative.
    f.active([{ ...raw.demand[0], status: "Target 1 reached" }, ...raw.demand.slice(1)]);
    return { acquired: true, value };
  };
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => raw });
  const refreshed = await reader.refresh(f.input);
  assert.equal(raw.demand[0].status, "Running", "the stale scan itself is unchanged");
  assert.equal(refreshed.result.demand[0].status, "Target 1 reached");
  assert.equal(f.snapshot().result.demand[0].status, "Target 1 reached");
  assert.equal((await reader.read(f.input)).result.demand[0].status, "Target 1 reached");
});

test("a failed post-commit validation read never returns or publishes the unvalidated raw scan", async () => {
  const f = fixture();
  f.activeSetups.loadActive = async () => { throw new Error("validation read unavailable"); };
  const reader = createPublishedBoardReader({ now: () => NOW, scan: async () => board(NOW) });
  await assert.rejects(reader.refresh(f.input), /validation read unavailable/);
  assert.equal(f.saved(), 0);
  assert.equal(f.snapshot().result.scannedAt, f.result.scannedAt);
});

test("custom boards coordinate setup writes, cache only committed results and never publish the default snapshot", async () => {
  const f = fixture();
  const transactionStore = { ...f.activeSetups };
  let locks = 0;
  let calls = 0;
  f.snapshots.coordinateRefresh = async (work) => {
    locks += 1;
    return { acquired: true, value: await work(transactionStore) };
  };
  const reader = createPublishedBoardReader({ scan: async (_data, symbols, force, options) => {
    calls += 1;
    assert.deepEqual(symbols, ["BTCUSDT"]);
    assert.equal(force, calls > 1);
    assert.equal(options?.activeSetups, transactionStore);
    return board();
  } });
  const input = { ...f.input, symbols: ["BTCUSDT"] };
  await reader.read(input);
  await reader.read(input);
  assert.equal(calls, 1);
  assert.equal(locks, 1);
  await reader.read({ ...input, force: true });
  assert.equal(calls, 2);
  assert.equal(locks, 2);
  assert.equal(f.saved(), 0);
});

test("a cached custom board revalidates terminal or archived rows without repeating its market scan", async () => {
  const f = fixture();
  const hit = f.result.demand[0];
  const custom = { ...f.result, demand: [hit], demandTotal: 1,
    market: f.result.market.filter((row) => row.symbol === hit.symbol) };
  let calls = 0;
  const reader = createPublishedBoardReader({ scan: async () => { calls += 1; return custom; } });
  const input = { ...f.input, symbols: [hit.symbol] };
  assert.equal((await reader.read(input)).result.demandTotal, 1);
  f.active([{ ...hit, status: "Target 2 reached" }]);
  assert.equal((await reader.read(input)).result.demandTotal, 0);
  f.active([]);
  assert.equal((await reader.read(input)).result.demandTotal, 0);
  assert.equal(calls, 1);
  assert.equal(f.saved(), 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import * as lifecycle from "@/core/domain/analysis/setup-lifecycle";
import * as supplyDemand from "@/core/domain/analysis/supply-demand";
import { setupSignature } from "@/core/domain/analysis/setup-signature";
import * as timeframe from "@/core/domain/market/timeframe";
import * as exchange from "@/core/domain/market/exchange";
import { mapConcurrent } from "@/shared/lib/async";

function setup(symbol: string, zoneBaseTime = 1000, status = "Running"): ActiveSetup {
  return { symbol, timeframe: "15m", direction: "long", entry: 100, target1: 110, target2: 120, stopLoss: 90,
    confidence: 75, zoneTop: 100, zoneBottom: 95, zoneBaseTime, status };
}

interface StoredSetup extends ActiveSetup {
  archivedAt?: Date | null;
  archiveReason?: string | null;
  updatedAt?: Date;
}

function fixture(initial: StoredSetup[] = [], failure?: Error, wait?: (signature: string, operation: string) => Promise<void>) {
  const rows = new Map(initial.map((row) => [setupSignature(row), { ...row }]));
  const events: Array<{ signature: string; operation: string }> = [];
  let active = 0;
  let peak = 0;
  async function query<T>(signature: string, operation: string, run: () => T): Promise<T> {
    events.push({ signature, operation: `${operation}.start` });
    active += 1;
    peak = Math.max(peak, active);
    try {
      await (wait?.(signature, operation) ?? new Promise<void>((resolve) => setImmediate(resolve)));
      if (failure) throw failure;
      const result = run();
      events.push({ signature, operation: `${operation}.finished` });
      return result;
    } finally {
      active -= 1;
    }
  }
  const exports: { activeSetupStore?: ActiveSetupPort;
    createActiveSetupStore?: (database: unknown, transactional: boolean) => ActiveSetupPort } = {};
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "@/core/domain/analysis/setup-lifecycle": lifecycle,
    "@/core/domain/analysis/supply-demand": supplyDemand,
    "@/core/domain/market/timeframe": timeframe,
    "@/core/domain/market/exchange": exchange,
    "@/core/domain/analysis/setup-signature": { setupSignature },
    "@/shared/lib/async": { mapConcurrent },
    "@/infrastructure/database/prisma": { prisma: { trackedSetup: {
      findMany: async ({ where }: { where: { symbol: { in: string[] }; archivedAt?: null; status?: { notIn: string[] };
        zoneBaseTime?: { gte: number }; OR?: Array<{ status?: { in: string[] }; archivedAt?: { not: null } }> } }) =>
        [...rows.values()].filter((row) => where.symbol.in.includes(row.symbol)
          && (where.archivedAt !== null || !row.archivedAt)
          && (!where.status || !where.status.notIn.includes(row.status))
          && (!where.zoneBaseTime || row.zoneBaseTime >= where.zoneBaseTime.gte)
          && (!where.OR || where.OR.some((condition) => condition.status?.in.includes(row.status) || condition.archivedAt && row.archivedAt)))
          .map((row) => ({ ...row, signature: setupSignature(row), firstSeenAt: new Date((row.publishedAt ?? 0) * 1000), updatedAt: row.updatedAt ?? new Date(0) })),
      updateMany: ({ where, data }: { where: { signature: string; exchange: string | null; archivedAt: null; status: string | { notIn: string[] }; updatedAt?: Date }; data: Pick<ActiveSetup, "status" | "zoneBaseTime"> }) => query(where.signature, "update", () => {
        const row = rows.get(where.signature);
        if (!row || row.archivedAt || (row.exchange ?? null) !== where.exchange
          || (typeof where.status === "string" ? row.status !== where.status : where.status.notIn.includes(row.status))
          || (where.updatedAt && (row.updatedAt?.getTime() ?? 0) !== where.updatedAt.getTime())) return { count: 0 };
        Object.assign(row, data);
        row.updatedAt = new Date((row.updatedAt?.getTime() ?? 0) + 1);
        return { count: 1 };
      }),
      findUnique: async ({ where }: { where: { signature: string } }) => {
        const row = rows.get(where.signature);
        return row ? { status: row.status, exchange: row.exchange ?? null, archivedAt: row.archivedAt ?? null } : null;
      },
      createMany: ({ data: [data], skipDuplicates }: { data: Array<ActiveSetup & { signature: string }>; skipDuplicates: boolean }) => query(data.signature, "create", () => {
        assert.equal(skipDuplicates, true, "a duplicate must not poison a fenced transaction");
        if (rows.has(data.signature)) return { count: 0 };
        rows.set(data.signature, { ...data });
        return { count: 1 };
      }),
    } } },
    "@/infrastructure/database/setup-read": { readSetupRows: async (_read: string, work: () => Promise<unknown>, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      return work();
    } },
  };
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/persistence/active-setup-store.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Error, Date,
    require: (name: string) => dependencies[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
  });
  const database = (dependencies["@/infrastructure/database/prisma"] as { prisma: unknown }).prisma;
  return { store: exports.activeSetupStore!, factory: exports.createActiveSetupStore!,
    transaction: () => exports.createActiveSetupStore!(database, true), rows, events, peak: () => peak };
}

test("a capture advancing a scanned Running setup to Target 1 cannot be overwritten by the fenced scan", async () => {
  const recent = Math.floor(Date.now() / 1000) - 9000;
  const initial = { ...setup("BTCUSDT", recent), exchange: "binance" as const, updatedAt: new Date(1000) };
  const f = fixture([initial]);
  const store = f.transaction();
  const [observed] = await store.loadActive([initial.symbol]);
  const current = f.rows.get(setupSignature(initial))!;
  current.status = "Target 1 reached";
  current.updatedAt = new Date(2000);
  await store.persist([{ ...observed, status: "Running" }]);
  assert.equal(current.status, "Target 1 reached");
  assert.equal(current.updatedAt.getTime(), 2000);
  assert.equal(f.rows.size, 1, "a lost compare-and-set cannot insert a second copy");
  assert.equal((await store.loadActive([initial.symbol]))[0].status, "Target 1 reached");
});

test("matching status after a concurrent status cycle is insufficient without the observed row version", async () => {
  const recent = Math.floor(Date.now() / 1000) - 9000;
  const initial = { ...setup("BTCUSDT", recent, "Filled"), exchange: "binance" as const, updatedAt: new Date(1000) };
  const f = fixture([initial]);
  const store = f.transaction();
  const [observed] = await store.loadActive([initial.symbol]);
  const current = f.rows.get(setupSignature(initial))!;
  current.status = "Running";
  current.updatedAt = new Date(2000);
  current.status = "Filled";
  current.updatedAt = new Date(3000);
  await store.persist([{ ...observed, status: "Target 1 reached" }]);
  assert.equal(current.status, "Filled");
  assert.equal(current.updatedAt.getTime(), 3000);
});

test("an unchanged observed setup can change dynamic status without imposing a lifecycle rank", async () => {
  const recent = Math.floor(Date.now() / 1000) - 9000;
  const initial = { ...setup("BTCUSDT", recent), exchange: "binance" as const, updatedAt: new Date(1000) };
  const f = fixture([initial]);
  const store = f.transaction();
  const [observed] = await store.loadActive([initial.symbol]);
  await store.persist([{ ...observed, status: "Filled" }]);
  assert.equal(f.rows.get(setupSignature(initial))?.status, "Filled");
  assert.equal(f.events.filter((event) => event.operation === "create.start").length, 0);
});

test("publication time is read from firstSeenAt and remains immutable across status updates", async () => {
  const recent = Math.floor(Date.now() / 1000) - 9000;
  const initial = { ...setup("BTCUSDT", recent), exchange: "binance" as const, publishedAt: recent + 100.123 };
  const f = fixture([initial]);
  const store = f.transaction();
  const [observed] = await store.loadActive([initial.symbol]);
  assert.equal(observed.publishedAt, initial.publishedAt);
  await store.persist([{ ...observed, status: "Target 1 reached" }]);
  assert.equal((await store.loadActive([initial.symbol]))[0].publishedAt, initial.publishedAt);
});

test("a fenced scan cannot overwrite a concurrently published row that was absent from its initial read", async () => {
  const recent = Math.floor(Date.now() / 1000) - 9000;
  const row = { ...setup("BTCUSDT", recent, "Target 1 reached"), exchange: "binance" as const, updatedAt: new Date(2000) };
  const f = fixture();
  const store = f.transaction();
  assert.equal((await store.loadActive([row.symbol])).length, 0);
  f.rows.set(setupSignature(row), row);
  await store.persist([{ ...row, status: "Running" }]);
  assert.equal(row.status, "Target 1 reached");
  assert.equal(row.updatedAt.getTime(), 2000);
  assert.equal(f.events.filter((event) => event.operation === "update.start").length, 0);
  assert.equal(f.rows.size, 1);
});

test("a lost fenced terminal update cannot publish a replacement while capture's current plan is still active", async () => {
  const recent = Math.floor(Date.now() / 1000) - 9000;
  const initial = { ...setup("BTCUSDT", recent), exchange: "binance" as const, updatedAt: new Date(1000) };
  const replacement = { ...setup(initial.symbol, recent + 900, "Limit Order"), exchange: "binance" as const };
  const f = fixture([initial]);
  const store = f.transaction();
  const [observed] = await store.loadActive([initial.symbol]);
  const current = f.rows.get(setupSignature(initial))!;
  current.status = "Target 1 reached";
  current.updatedAt = new Date(2000);
  await store.persist([{ ...observed, status: "Target 2 reached" }, replacement]);
  assert.equal(current.status, "Target 1 reached");
  assert.equal(f.rows.has(setupSignature(replacement)), false);
  assert.equal(f.rows.size, 1);
});

test("a replacement may publish after a lost fenced update when capture has actually finished the old plan", async () => {
  const recent = Math.floor(Date.now() / 1000) - 9000;
  const initial = { ...setup("BTCUSDT", recent), exchange: "binance" as const, updatedAt: new Date(1000) };
  const replacement = { ...setup(initial.symbol, recent + 900, "Limit Order"), exchange: "binance" as const };
  const f = fixture([initial]);
  const store = f.transaction();
  const [observed] = await store.loadActive([initial.symbol]);
  const current = f.rows.get(setupSignature(initial))!;
  current.status = "Invalidated (SL hit)";
  current.updatedAt = new Date(2000);
  await store.persist([{ ...observed, status: "Target 2 reached" }, replacement]);
  assert.equal(current.status, "Invalidated (SL hit)");
  assert.equal(current.updatedAt.getTime(), 2000);
  assert.equal(f.rows.get(setupSignature(replacement))?.status, "Limit Order");
  assert.equal(f.rows.size, 2);
});

test("fenced stores never retry a lost transaction or fall back to global reads and writes", async () => {
  const f = fixture();
  const closed = new Error("Connection terminated unexpectedly");
  let reads = 0;
  let writes = 0;
  const transaction = { trackedSetup: {
    findMany: async () => { reads += 1; throw closed; },
    updateMany: async () => { writes += 1; throw closed; },
    createMany: async () => { writes += 1; throw closed; },
  } };
  const store = f.factory(transaction, true);
  await assert.rejects(store.loadActive(["BTCUSDT"]), (error) => error === closed);
  assert.equal(reads, 1, "a failed transaction must not retry on another connection");
  await assert.rejects(store.persist([setup("BTCUSDT")]), (error) => error === closed);
  assert.equal(writes, 1);
  assert.equal(f.rows.size, 0, "a rejected fenced write cannot leak to the global store");
  assert.equal(f.events.length, 0);
});

test("a skipped insert is accepted only when its published signature actually exists", async () => {
  const f = fixture();
  const store = f.factory({ trackedSetup: {
    updateMany: async () => ({ count: 0 }),
    createMany: async () => ({ count: 0 }),
    findUnique: async () => null,
  } }, true);
  await assert.rejects(store.persist([setup("BTCUSDT")]), /insert conflict; refresh required/);
  assert.equal(f.rows.size, 0);
});

test("published writes run four symbols together while closing each old setup before its replacement", async () => {
  const existing = Array.from({ length: 9 }, (_, index) => setup(`COIN${index}USDT`));
  const fixtureData = fixture(existing);
  const changes = existing.flatMap((row) => [{ ...row, status: "Target 2 reached" }, setup(row.symbol, 2000)]);
  await fixtureData.store.persist(changes);
  assert.equal(fixtureData.peak(), 4);
  for (const old of existing) {
    const oldSignature = setupSignature(old);
    const replacementSignature = setupSignature({ ...old, zoneBaseTime: 2000 });
    const closed = fixtureData.events.findIndex((event) => event.signature === oldSignature && event.operation === "update.finished");
    const replacement = fixtureData.events.findIndex((event) => event.signature === replacementSignature && event.operation === "update.start");
    assert.ok(closed >= 0 && replacement > closed, "a symbol must finish the old write before its replacement starts");
    assert.equal(fixtureData.rows.get(oldSignature)?.status, "Target 2 reached");
    assert.equal(fixtureData.rows.get(replacementSignature)?.status, "Running");
  }
});

test("archived legacy plans leave the active board and retire their zone without changing historical trade fields", async () => {
  const recent = Math.floor(Date.now() / 1000) - 9000;
  const archived: StoredSetup = { ...setup("BTCUSDT", recent, "Running"), exchange: null,
    archivedAt: new Date(), archiveReason: "legacy_exchange_unverified" };
  const active = { ...setup("BTCUSDT", recent + 900, "Limit Order"), exchange: "binance" as const, archivedAt: null };
  const terminal = setup("ETHUSDT", recent, "Target 2 reached");
  const tooOld = { ...archived, symbol: "OLDUSDT", zoneBaseTime: recent - 2_000_000 };
  const fixtureData = fixture([archived, active, terminal, tooOld]);
  const symbols = ["BTCUSDT", "ETHUSDT", "OLDUSDT"];
  const board = await fixtureData.store.loadActive(symbols);
  assert.equal(board.length, 1);
  assert.equal(board[0].zoneBaseTime, active.zoneBaseTime);
  assert.equal(board[0].exchange, "binance");
  const retired = await fixtureData.store.loadRetiredZones(symbols);
  assert.deepEqual(retired.map((row) => row.zoneBaseTime), [archived.zoneBaseTime, terminal.zoneBaseTime]);
  assert.deepEqual(fixtureData.rows.get(setupSignature(archived)), archived);
  assert.deepEqual(fixtureData.rows.get(setupSignature(terminal)), terminal);
});

test("a stale scan cannot reactivate or assign a new outcome to an archived signature", async () => {
  const archived: StoredSetup = { ...setup("BTCUSDT"), exchange: null, archivedAt: new Date(), archiveReason: "legacy_exchange_unverified" };
  const fixtureData = fixture([archived]);
  await assert.rejects(fixtureData.store.persist([{ ...archived, exchange: "binance", status: "Target 2 reached", entry: 105 }]), /setup archived; refresh required/);
  assert.deepEqual(fixtureData.rows.get(setupSignature(archived)), archived);
  const replacement = { ...setup("BTCUSDT", 2000, "Limit Order"), exchange: "binance" as const };
  await fixtureData.store.persist([replacement]);
  assert.equal(fixtureData.rows.get(setupSignature(replacement))?.status, "Limit Order");
  assert.equal(fixtureData.rows.get(setupSignature(replacement))?.exchange, "binance");
  assert.equal(fixtureData.rows.get(setupSignature(archived))?.status, "Running");
});

test("archival committed while a stale update waits prevents that update from recording a lifecycle result", async () => {
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { resume = resolve; });
  const legacy: StoredSetup = { ...setup("BTCUSDT"), exchange: null, archivedAt: null };
  const fixtureData = fixture([legacy], undefined, (_signature, operation) => operation === "update" ? waiting : Promise.resolve());
  const pending = fixtureData.store.persist([{ ...legacy, status: "Target 2 reached" }]);
  const retained = fixtureData.rows.get(setupSignature(legacy))!;
  retained.archivedAt = new Date();
  retained.archiveReason = "legacy_exchange_unverified";
  resume();
  await assert.rejects(pending, /setup archived; refresh required/);
  assert.equal(retained.status, "Running");
  assert.equal(retained.entry, 100);
  assert.equal(retained.exchange, null);
});

test("parallel persistence preserves terminal rows and published levels, and only ignores duplicate-key races", async () => {
  const terminal = setup("TERMINALUSDT", 1000, "Invalidated (SL hit)");
  const live = setup("LIVEUSDT");
  const fixtureData = fixture([terminal, live]);
  await fixtureData.store.persist([{ ...terminal, status: "Filled", stopLoss: 80 }, { ...live, status: "Filled", entry: 101, stopLoss: 81 }]);
  assert.equal(fixtureData.rows.get(setupSignature(terminal))?.status, "Invalidated (SL hit)");
  assert.equal(fixtureData.rows.get(setupSignature(terminal))?.stopLoss, 90);
  assert.equal(fixtureData.rows.get(setupSignature(live))?.status, "Filled");
  assert.equal(fixtureData.rows.get(setupSignature(live))?.entry, 100);
  assert.equal(fixtureData.rows.get(setupSignature(live))?.stopLoss, 90);

  const unavailable = fixture([], Object.assign(new Error("database unavailable"), { code: "P1001" }));
  await assert.rejects(unavailable.store.persist([setup("BTCUSDT")]), /database unavailable/);
  assert.equal(unavailable.rows.size, 0);
});

test("published feed is recorded once and cannot be silently adopted by another exchange", async () => {
  const original = { ...setup("BTCUSDT"), exchange: "binance" as const };
  const fixtureData = fixture([original]);
  await fixtureData.store.persist([{ ...original, status: "Filled" }]);
  assert.equal(fixtureData.rows.get(setupSignature(original))?.exchange, "binance");
  await assert.rejects(fixtureData.store.persist([{ ...original, exchange: "bybit", status: "Target 1 reached" }]), /exchange conflict/);
  assert.equal(fixtureData.rows.get(setupSignature(original))?.status, "Filled");
  const legacy = { ...setup("LEGACYUSDT"), exchange: null };
  const unknown = fixture([legacy]);
  await assert.rejects(unknown.store.persist([{ ...legacy, exchange: "binance", status: "Running" }]), /exchange conflict/);
  assert.equal(unknown.rows.get(setupSignature(legacy))?.exchange, null);
});

test("a failed persistence group stops queued writes and rejects only after every started write settles", async () => {
  let failFirst!: (error: Error) => void;
  let finishFirstSlow!: () => void;
  let finishOthers!: () => void;
  const failedWrite = new Promise<void>((_, reject) => { failFirst = reject; });
  const firstSlowWrite = new Promise<void>((resolve) => { finishFirstSlow = resolve; });
  const otherWrites = new Promise<void>((resolve) => { finishOthers = resolve; });
  const failed = setup("FAILUSDT");
  const firstSlow = setup("SLOW1USDT");
  const missingSlow = setup("SLOW2USDT");
  const lastSlow = setup("SLOW3USDT");
  const fixtureData = fixture([firstSlow, lastSlow], undefined, (signature, operation) => {
    assert.equal(operation, "update", "no create may follow an update once another group failed");
    if (signature === setupSignature(failed)) return failedWrite;
    if (signature === setupSignature(firstSlow)) return firstSlowWrite;
    return otherWrites;
  });
  let settled = false;
  const pending = fixtureData.store.persist([
    failed, { ...firstSlow, status: "Target 2 reached" }, setup(firstSlow.symbol, 2000),
    missingSlow, lastSlow, ...Array.from({ length: 5 }, (_, index) => setup(`QUEUED${index}USDT`)),
  ]);
  pending.then(() => { settled = true; }, () => { settled = true; });
  assert.equal(fixtureData.events.length, 4, "only the four initial groups may dispatch");
  const failure = new Error("database write failed");
  failFirst(failure);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the first failure must not release the scan while writes remain active");
  assert.equal(fixtureData.events.filter((event) => event.operation.endsWith(".start")).length, 4);

  finishFirstSlow();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "all started writes must drain, including the slowest group");
  assert.equal(fixtureData.events.filter((event) => event.operation.endsWith(".start")).length, 4);
  finishOthers();
  await assert.rejects(pending, (error) => error === failure);
  assert.equal(fixtureData.events.filter((event) => event.operation.endsWith(".start")).length, 4);
  assert.equal(fixtureData.rows.has(setupSignature({ ...firstSlow, zoneBaseTime: 2000 })), false);
  assert.equal(fixtureData.rows.has(setupSignature(missingSlow)), false);
});

test("an expired scan deadline stops queued writes and replacements while draining the database work already started", async () => {
  const controller = new AbortController();
  let finishFirst!: () => void;
  let finishOthers!: () => void;
  const first = new Promise<void>((resolve) => { finishFirst = resolve; });
  const others = new Promise<void>((resolve) => { finishOthers = resolve; });
  const existing = Array.from({ length: 9 }, (_, index) => setup(`DEADLINE${index}USDT`));
  const fixtureData = fixture(existing, undefined, (signature, operation) => {
    assert.equal(operation, "update", "the deadline must prevent both new creates and replacement writes");
    return signature === setupSignature(existing[0]) ? first : others;
  });
  const changes = existing.flatMap((row) => [{ ...row, status: "Target 2 reached" }, setup(row.symbol, 2000)]);
  const pending = fixtureData.store.persist(changes, controller.signal);
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  assert.equal(fixtureData.events.length, 4);
  const reason = new DOMException("Scan deadline exceeded", "TimeoutError");
  controller.abort(reason);
  finishFirst();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the cache's guard must stay held until every in-flight database write settles");
  assert.equal(fixtureData.events.filter((event) => event.operation.endsWith(".start")).length, 4);
  finishOthers();
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(fixtureData.events.filter((event) => event.operation.endsWith(".start")).length, 4);
  assert.equal(fixtureData.rows.size, existing.length);
  assert.ok(existing.every((row) => !fixtureData.rows.has(setupSignature({ ...row, zoneBaseTime: 2000 }))));
  const alreadyExpired = fixture(existing);
  await assert.rejects(alreadyExpired.store.persist(changes, controller.signal), (error) => error === reason);
  assert.deepEqual(alreadyExpired.events, []);
});

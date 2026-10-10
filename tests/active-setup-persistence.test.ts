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
  const exports: { activeSetupStore?: ActiveSetupPort } = {};
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
          && (!where.OR || where.OR.some((condition) => condition.status?.in.includes(row.status) || condition.archivedAt && row.archivedAt))),
      updateMany: ({ where, data }: { where: { signature: string; exchange: string | null; archivedAt: null; status: { notIn: string[] } }; data: Pick<ActiveSetup, "status" | "zoneBaseTime"> }) => query(where.signature, "update", () => {
        const row = rows.get(where.signature);
        if (!row || row.archivedAt || where.status.notIn.includes(row.status) || (row.exchange ?? null) !== where.exchange) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findUnique: async ({ where }: { where: { signature: string } }) => {
        const row = rows.get(where.signature);
        return row ? { status: row.status, exchange: row.exchange ?? null, archivedAt: row.archivedAt ?? null } : null;
      },
      create: ({ data }: { data: ActiveSetup & { signature: string } }) => query(data.signature, "create", () => {
        if (rows.has(data.signature)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        rows.set(data.signature, { ...data });
        return data;
      }),
    } } },
  };
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/persistence/active-setup-store.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Error, Date,
    require: (name: string) => dependencies[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
  });
  return { store: exports.activeSetupStore!, rows, events, peak: () => peak };
}

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

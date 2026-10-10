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

function fixture(initial: ActiveSetup[] = [], failure?: Error, wait?: (signature: string, operation: string) => Promise<void>) {
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
      updateMany: ({ where, data }: { where: { signature: string; exchange: string | null; status: { notIn: string[] } }; data: Pick<ActiveSetup, "status" | "zoneBaseTime"> }) => query(where.signature, "update", () => {
        const row = rows.get(where.signature);
        if (!row || where.status.notIn.includes(row.status) || (row.exchange ?? null) !== where.exchange) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findUnique: async ({ where }: { where: { signature: string } }) => {
        const row = rows.get(where.signature);
        return row ? { status: row.status, exchange: row.exchange ?? null } : null;
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SignalsSnapshotPort } from "@/core/application/ports/signals-snapshot-port";
import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  type Transaction = { open: boolean; held: boolean; $queryRaw: (sql: TemplateStringsArray) => Promise<Array<{ acquired: boolean }>> };
  let owner: Transaction | undefined;
  const transactions: Transaction[] = [];
  const options: Array<{ maxWait: number; timeout: number }> = [];
  const lockQueries: string[] = [];
  const writes: ActiveSetup[] = [];
  const events: string[] = [];
  const lost = new Error("Transaction already closed");
  const close = (transaction: Transaction) => {
    transaction.open = false;
    if (owner === transaction) owner = undefined;
    transaction.held = false;
  };
  const database = {
    async $transaction<T>(work: (transaction: Transaction) => Promise<T>, limits: { maxWait: number; timeout: number }) {
      options.push(limits);
      const transaction: Transaction = { open: true, held: false, $queryRaw: async (sql) => {
        lockQueries.push(sql.join("$"));
        if (owner) return [{ acquired: false }];
        owner = transaction;
        transaction.held = true;
        return [{ acquired: true }];
      } };
      transactions.push(transaction);
      events.push("begin");
      try {
        const value = await work(transaction);
        if (!transaction.open) throw lost;
        events.push("commit");
        return value;
      } catch (error) {
        events.push("rollback");
        throw error;
      } finally { close(transaction); }
    },
  };
  const exports: { signalsSnapshotStore?: SignalsSnapshotPort } = {};
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/persistence/signals-snapshot-store.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name === "@/infrastructure/database/prisma") return { prisma: database };
      if (name === "@/infrastructure/database/setup-read") return { readSetupRows: async () => { throw new Error("unexpected standalone read"); } };
      if (name === "@/infrastructure/persistence/active-setup-store") return {
        createActiveSetupStore: (transaction: Transaction, transactional: boolean): ActiveSetupPort => {
          assert.ok(transactions.includes(transaction), "fenced writes must use the acquired transaction client");
          assert.equal(transactional, true);
          return {
            loadActive: async () => [], loadRetiredZones: async () => [],
            persist: async (rows) => {
              if (!transaction.open || !transaction.held || owner !== transaction) throw lost;
              writes.push(...rows);
            },
          };
        },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { store: exports.signalsSnapshotStore!, transactions, options, lockQueries, writes, events, close, lost };
}

function setup(status = "Running"): ActiveSetup {
  return { symbol: "BTCUSDT", exchange: "binance", timeframe: "15m", direction: "long",
    entry: 100, target1: 110, target2: 120, stopLoss: 90, confidence: 75,
    zoneTop: 100, zoneBottom: 95, zoneBaseTime: 1000, status };
}

test("native transaction advisory locking makes a competing refresh busy and holds ownership through commit", async () => {
  const f = fixture();
  const gate = deferred();
  const first = f.store.coordinateRefresh!(async (active) => {
    await gate.promise;
    await active.persist([setup()]);
    return "completed";
  });
  let secondRan = false;
  const second = await f.store.coordinateRefresh!(async () => { secondRan = true; return "duplicate"; });
  assert.equal(second.acquired, false);
  assert.equal(secondRan, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.transactions[0].held, true);
  gate.resolve();
  const completed = await first;
  assert.equal(completed.acquired, true);
  if (completed.acquired) assert.equal(completed.value, "completed");
  assert.equal(f.transactions[0].held, false);
  assert.equal(f.writes.length, 1);
  assert.equal(f.options[0].maxWait, 10_000);
  assert.equal(f.options[0].timeout, 65_000);
  assert.ok(f.lockQueries.every((query) => query.includes("pg_try_advisory_xact_lock(98321401, 1)")));
});

test("a disconnected owner cannot resume writes after a new transaction acquires refresh ownership", async () => {
  const f = fixture();
  const gate = deferred();
  const old = f.store.coordinateRefresh!(async (active) => {
    await gate.promise;
    await active.persist([setup("Limit Order")]);
    return "old";
  });
  const rejection = assert.rejects(old, (error) => error === f.lost);
  f.close(f.transactions[0]);
  const replacement = await f.store.coordinateRefresh!(async (active) => {
    await active.persist([setup("Running")]);
    return "new";
  });
  assert.equal(replacement.acquired, true);
  gate.resolve();
  await rejection;
  assert.deepEqual(f.writes.map((row) => row.status), ["Running"]);
  assert.ok(f.events.includes("rollback"));
});

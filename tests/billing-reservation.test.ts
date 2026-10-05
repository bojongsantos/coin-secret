import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { withSerializationRetry } from "@/infrastructure/billing/transaction-retry";

type Order = { userId: string; provider: string; planPeriod: string; amount: number; currency: string; grantedDays: number };
type Payment = Order & { id: string; orderId: string; status: string; rawStatus: string; checkoutToken: null; checkoutUrl: null };
type Reservation = { payment: Payment; existing: boolean };
const purchase: Order = { userId: "buyer", provider: "nowpayments", planPeriod: "sixMonth", amount: 60, currency: "USD", grantedDays: 180 };

function fixture(race = false) {
  let rows: Payment[] = [];
  let revision = 0;
  let attempts = 0;
  let created = 0;
  let conflictCount = 0;
  let releaseSnapshots!: () => void;
  const snapshotsReady = new Promise<void>((resolve) => { releaseSnapshots = resolve; });
  const prisma = { async $transaction(work: (tx: unknown) => Promise<Reservation>, options: { isolationLevel: string }) {
    assert.equal(options.isolationLevel, "Serializable");
    const snapshot = revision;
    const draft = rows.map((row) => ({ ...row }));
    let wrote = false;
    const attempt = ++attempts;
    // Both first attempts must observe the same empty predicate before either commits.
    if (race && attempt <= 2) {
      if (attempt === 2) releaseSnapshots();
      await snapshotsReady;
    }
    const result = await work({ payment: {
      async findFirst({ where }: { where: Partial<Payment> }) {
        return draft.find((row) => Object.entries(where).every(([key, value]) => row[key as keyof Payment] === value)) ?? null;
      },
      async create({ data }: { data: Order & { orderId: string; rawStatus: string } }) {
        const row: Payment = { ...data, id: `payment-${++created}`, status: "PENDING", checkoutToken: null, checkoutUrl: null };
        draft.push(row);
        wrote = true;
        return row;
      },
    } });
    if (wrote && snapshot !== revision) {
      conflictCount++;
      throw { code: "P2034" };
    }
    if (wrote) { rows = draft; revision++; }
    return result;
  } };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { randomUUID },
    "@/infrastructure/database/prisma": { prisma },
    "@/infrastructure/billing/transaction-retry": { withSerializationRetry },
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/billing/checkout-reservation.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Date,
    require(name: string) {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    reserve: exports.reserveCheckout as (input: Order) => Promise<Reservation>,
    rows: () => rows, attempts: () => attempts, conflicts: () => conflictCount,
  };
}

test("parallel checkout reservations reread after a serialization conflict and share one order", async () => {
  const f = fixture(true);
  const results = await Promise.all([f.reserve(purchase), f.reserve(purchase)]);
  assert.equal(f.conflicts(), 1);
  assert.equal(f.attempts(), 3);
  assert.equal(f.rows().length, 1);
  assert.equal(results[0].payment.id, results[1].payment.id);
  assert.equal(results[0].payment.orderId, results[1].payment.orderId);
  assert.deepEqual(results.map((result) => result.existing).sort(), [false, true]);
  assert.equal(f.rows()[0].grantedDays, 180);
});

test("reusing a pending invoice retains its purchased duration after catalogue changes", async () => {
  const f = fixture();
  const first = await f.reserve(purchase);
  const reused = await f.reserve({ ...purchase, grantedDays: 90 });
  assert.equal(reused.existing, true);
  assert.equal(reused.payment.orderId, first.payment.orderId);
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0].grantedDays, 180);
});

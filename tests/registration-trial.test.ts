import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as subscriptionRules from "@/core/domain/access/subscription";

function fixture(options: { plan?: string; existing?: boolean; failUpdate?: boolean; createdAt?: Date } = {}) {
  const createdAt = options.createdAt ?? new Date(Date.now() - 60_000);
  let state: { plan: string; subscription: Record<string, unknown> | null; writes: number } = {
    plan: options.plan ?? "FREE", subscription: options.existing ? { provider: "paid", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } : null, writes: 0,
  };
  const prisma = { $transaction: async (work: (tx: unknown) => Promise<unknown>, isolation: { isolationLevel: string }) => {
    assert.equal(isolation.isolationLevel, "Serializable");
    const draft = { ...state };
    await work({
      user: {
        findUnique: async () => ({ plan: draft.plan, createdAt, subscription: draft.subscription }),
        update: async ({ data }: { data: { plan: string } }) => { if (options.failUpdate) throw new Error("write failed"); draft.plan = data.plan; },
      },
      subscription: { create: async ({ data }: { data: Record<string, unknown> }) => { draft.subscription = data; draft.writes++; } },
    });
    state = draft;
  } };
  const exports: Record<string, unknown> = {};
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "@/core/domain/access/subscription": subscriptionRules,
    "@/infrastructure/database/prisma": { prisma },
    "@/infrastructure/billing/transaction-retry": { withSerializationRetry: (fn: () => Promise<unknown>) => fn() },
  };
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/auth/registration-trial.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Date, require(name: string) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); },
  });
  return { initialize: exports.initializeRegistrationTrial as (id: string) => Promise<void>, state: () => state, createdAt };
}

test("new registrations receive exactly seven days and expire at the boundary", async () => {
  const f = fixture(); await f.initialize("new-user");
  assert.equal(f.state().plan, "PREMIUM");
  const current = f.state().subscription!;
  assert.equal(current.provider, "trial");
  assert.equal((current.currentPeriodStart as Date).getTime(), f.createdAt.getTime());
  const end = current.currentPeriodEnd as Date;
  assert.equal(end.getTime() - f.createdAt.getTime(), 7 * 86_400_000);
  assert.equal(subscriptionRules.effectivePlan("PREMIUM", end, new Date(end.getTime() - 1)), "PREMIUM");
  assert.equal(subscriptionRules.effectivePlan("PREMIUM", end, end), "FREE");
});

test("registration retries and email verification keep the original trial end", async () => {
  const f = fixture({ createdAt: new Date(Date.now() - 2 * 86_400_000) });
  await f.initialize("same-user"); const end = f.state().subscription!.currentPeriodEnd;
  await f.initialize("same-user");
  assert.equal(f.state().subscription!.currentPeriodEnd, end);
  assert.equal((end as Date).getTime(), f.createdAt.getTime() + 7 * 86_400_000);
  assert.equal(f.state().writes, 1);
});

test("trial repair never overwrites paid, manual, or expired registration access", async () => {
  for (const options of [{ plan: "PREMIUM" }, { existing: true }, { createdAt: new Date(Date.now() - 8 * 86_400_000) }]) {
    const f = fixture(options); const before = f.state(); await f.initialize("existing-user");
    assert.deepEqual(f.state(), before);
    assert.equal(f.state().writes, 0);
  }
});

test("a failure cannot persist a trial subscription without its matching plan", async () => {
  const f = fixture({ failUpdate: true });
  await assert.rejects(f.initialize("new-user"), /write failed/);
  assert.equal(f.state().plan, "FREE"); assert.equal(f.state().subscription, null);
});

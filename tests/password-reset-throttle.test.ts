import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Row = { key: string; count: number; lastRequest: bigint };
function fixture() {
  const rows = new Map<string, Row>();
  let tail = Promise.resolve();
  let locks = 0;
  const tx = {
    async $queryRaw() { locks++; },
    rateLimit: {
      async findUnique({ where }: { where: { key: string } }) { return rows.get(where.key) ?? null; },
      async upsert({ where, create, update }: { where: { key: string }; create: Row; update: Partial<Row> }) {
        rows.set(where.key, rows.has(where.key) ? { ...rows.get(where.key)!, ...update } : create);
      },
    },
  };
  const prisma = {
    async $transaction<T>(body: (transaction: typeof tx) => Promise<T>) {
      const before = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await before;
      try { return await body(tx); } finally { release(); }
    },
  };
  function load() {
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/auth/password-reset-throttle.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      exports,
      require(name: string) {
        if (name === "server-only") return {};
        if (name === "node:crypto") return { createHash };
        if (name === "@/infrastructure/database/prisma") return { prisma };
        throw new Error(`Unexpected import ${name}`);
      },
    });
    return exports.passwordResetThrottle as (email: string, action: "send" | "verify", now: number) => Promise<number>;
  }
  return { load, rows, locks: () => locks };
}

test("reset send cooldown is shared across module instances, normalized email and concurrent calls", async () => {
  const f = fixture();
  const first = f.load();
  const restarted = f.load();
  const results = await Promise.all([first(" Account@example.invalid ", "send", 1_000_000), restarted("account@example.invalid", "send", 1_000_000)]);
  assert.deepEqual(results, [0, 60]);
  assert.equal(f.locks(), 2);
  assert.equal(await restarted("ACCOUNT@example.invalid", "send", 1_030_000), 30);
  assert.ok([...f.rows.keys()].every((key) => !key.includes("account@example.invalid")), "Limiter keys do not expose email addresses");
  assert.equal(await first("another@example.invalid", "send", 1_030_000), 0);
});

test("reset email budget allows only three sends per ten minutes and resets at its boundary", async () => {
  const limit = fixture().load();
  assert.equal(await limit("account@example.invalid", "send", 1_000_000), 0);
  assert.equal(await limit("account@example.invalid", "send", 1_060_000), 0);
  assert.equal(await limit("account@example.invalid", "send", 1_120_000), 0);
  assert.equal(await limit("account@example.invalid", "send", 1_180_000), 420);
  assert.equal(await limit("account@example.invalid", "send", 1_600_000), 0);
});

test("recipient verification attempts cannot exceed five per five minutes even after resending", async () => {
  const limit = fixture().load();
  for (let i = 0; i < 5; i++) assert.equal(await limit("account@example.invalid", "verify", 1_000_000), 0);
  assert.equal(await limit("account@example.invalid", "verify", 1_000_000), 300);
  assert.equal(await limit("account@example.invalid", "send", 1_000_000), 0);
  assert.equal(await limit("account@example.invalid", "verify", 1_000_000), 300);
  assert.equal(await limit("account@example.invalid", "verify", 1_300_000), 0);
});

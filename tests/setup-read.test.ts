import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import ts from "typescript";

function fixture(wait: typeof delay = (async () => undefined) as typeof delay, now = () => performance.now()) {
  const diagnostics: unknown[][] = [];
  const waits: number[] = [];
  class HttpError extends Error {
    constructor(public status: number, message: string, public code: string) { super(message); }
  }
  const exports: { readSetupRows?: <T>(read: "active" | "retired" | "snapshot", work: () => Promise<T>, signal?: AbortSignal) => Promise<T> } = {};
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/database/setup-read.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    performance: { now },
    console: { warn: (...args: unknown[]) => diagnostics.push(args) },
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name === "@/shared/server/http") return { HttpError };
      if (name === "node:timers/promises") return { setTimeout: (...args: Parameters<typeof delay>) => { waits.push(args[0]!); return wait(...args); } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { read: exports.readSetupRows!, diagnostics, waits };
}

test("installed PrismaPg connection failures retry one fresh SELECT and preserve empty success", async () => {
  for (const [error, category] of [
    [new Error("Connection terminated due to connection timeout"), "connect-timeout"],
    [new Error("timeout exceeded when trying to connect"), "pool-timeout"],
    [new Error("Connection terminated unexpectedly"), "connection-lost"],
    [Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), "connection-lost"],
  ]) {
    const f = fixture();
    const pool = new Pool();
    let queries = 0;
    pool.query = (async () => {
      if (++queries === 1) throw error;
      return { rows: [], fields: [], rowCount: 0, command: "SELECT", oid: 0 };
    }) as typeof pool.query;
    const client = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      const result = await f.read("active", () => client.trackedSetup.findMany({ take: 1 }));
      assert.deepEqual(result, []);
      assert.equal(queries, 2);
      assert.deepEqual(f.waits, [200]);
      assert.equal(f.diagnostics.length, 1);
      assert.equal((f.diagnostics[0][1] as { category: string }).category, category);
    } finally {
      await client.$disconnect();
      await pool.end();
    }
  }
});

test("exhausted connection reads are unavailable rather than empty, with sanitized metadata only", async () => {
  let elapsed = 0;
  const f = fixture((async (ms: number) => { elapsed += ms; }) as typeof delay, () => elapsed);
  let calls = 0;
  const error = new Error("Connection terminated due to connection timeout SQL private-query-canary password private-secret-canary");
  await assert.rejects(f.read("snapshot", async () => { calls += 1; elapsed += 10_000; throw error; }), {
    status: 503, code: "SETUP_STORE_UNAVAILABLE",
  });
  assert.equal(calls, 2);
  assert.deepEqual(f.waits, [200]);
  assert.equal(f.diagnostics.length, 2);
  assert.doesNotMatch(JSON.stringify(f.diagnostics), /private-.*-canary|SQL/);
  assert.deepEqual(Object.keys(f.diagnostics[1][1] as object).sort(), ["aborted", "attempt", "attemptElapsedMs", "category", "elapsedMs", "read", "retrying"]);
  assert.equal((f.diagnostics[0][1] as { elapsedMs: number }).elapsedMs, 10_000);
  assert.equal((f.diagnostics[1][1] as { elapsedMs: number }).elapsedMs, 20_200);
  assert.equal((f.diagnostics[1][1] as { attemptElapsedMs: number }).attemptElapsedMs, 10_000);
});

test("installed PrismaPg server errors retain specific safe categories without broadening retries", async () => {
  for (const [code, message, category] of [
    ["57014", "canceling statement due to statement timeout", "statement-timeout"],
    ["57014", "canceling statement due to user request", "query-cancelled"],
    ["55P03", "canceling statement due to lock timeout", "lock-timeout"],
    ["55P03", "could not obtain lock on relation", "lock-unavailable"],
    ["53300", "too many clients already", "connection-capacity"],
    ["08006", "connection failure", "connection-lost"],
  ]) {
    let elapsed = 0;
    const f = fixture(undefined, () => elapsed);
    const pool = new Pool();
    let queries = 0;
    pool.query = (async () => {
      queries += 1;
      elapsed += 15_000;
      throw Object.assign(new Error(`${message} private-query-canary private-secret-canary`), { code, severity: "ERROR" });
    }) as typeof pool.query;
    const client = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      await assert.rejects(f.read("active", () => client.trackedSetup.findMany({ take: 1 })), {
        status: 503, code: "SETUP_STORE_UNAVAILABLE",
      });
      assert.equal(queries, 1, "adapter diagnostics must not expand the retry allowlist");
      assert.deepEqual(f.waits, []);
      const detail = f.diagnostics[0][1] as { category: string; elapsedMs: number; attemptElapsedMs: number; aborted: boolean };
      assert.equal(detail.category, category);
      assert.equal(detail.elapsedMs, 15_000);
      assert.equal(detail.attemptElapsedMs, 15_000);
      assert.equal(detail.aborted, false);
      assert.doesNotMatch(JSON.stringify(f.diagnostics), /private-.*-canary/);
    } finally {
      await client.$disconnect();
      await pool.end();
    }
  }
});

test("installed PrismaPg socket causes remain observable even when the outer code is generic", async () => {
  for (const [code, category, attempts] of [
    ["ETIMEDOUT", "socket-timeout", 1],
    ["ECONNREFUSED", "connection-unreachable", 2],
    ["ECONNRESET", "connection-lost", 2],
    ["CERT_HAS_EXPIRED", "tls-connection", 1],
  ] as const) {
    const f = fixture();
    const pool = new Pool();
    let queries = 0;
    pool.query = (async () => {
      queries += 1;
      throw Object.assign(new Error("private-query-canary private-host-canary"), { code, syscall: "connect", errno: -1 });
    }) as typeof pool.query;
    const client = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      await assert.rejects(f.read("snapshot", () => client.trackedSetup.findMany({ take: 1 })), { status: 503 });
      assert.equal(queries, attempts, "diagnosis must preserve the existing retry policy");
      assert.equal((f.diagnostics[0][1] as { category: string }).category, category);
      assert.doesNotMatch(JSON.stringify(f.diagnostics), /private-.*-canary/);
    } finally {
      await client.$disconnect();
      await pool.end();
    }
  }
});

test("statement, lock, schema, validation, and write-conflict errors never retry", async () => {
  for (const error of [
    Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }),
    Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }),
    Object.assign(new Error("column missing"), { code: "P2022" }),
    Object.assign(new Error("duplicate"), { code: "P2002" }),
    Object.assign(new Error("conflict"), { code: "P2034" }),
    new Error("Prisma validation failed"),
    new Error("Unexpected application timeout"),
  ]) {
    const f = fixture();
    let calls = 0;
    await assert.rejects(f.read("retired", async () => { calls += 1; throw error; }), {
      status: 503, code: "SETUP_STORE_UNAVAILABLE",
    });
    assert.equal(calls, 1);
    assert.deepEqual(f.waits, []);
  }
});

test("an expired read deadline prevents dispatch and stops a retry after the actual SELECT settles", async () => {
  const f = fixture();
  const controller = new AbortController();
  const reason = new DOMException("Scan deadline exceeded", "TimeoutError");
  let release!: () => void;
  const draining = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const pending = f.read("active", async () => {
    calls += 1;
    await draining;
    throw new Error("Connection terminated unexpectedly");
  }, controller.signal);
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  controller.abort(reason);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "an abort must not abandon the native database operation");
  release();
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(calls, 1);
  assert.deepEqual(f.waits, []);
  const detail = f.diagnostics[0][1] as { category: string; retrying: boolean; aborted: boolean; elapsedMs: number; attemptElapsedMs: number };
  assert.equal(detail.category, "connection-lost", "the native failure must remain observable after the deadline expires");
  assert.equal(detail.retrying, false);
  assert.equal(detail.aborted, true);
  assert.ok(detail.elapsedMs >= detail.attemptElapsedMs);
  assert.ok(detail.attemptElapsedMs >= 0);
  await assert.rejects(f.read("retired", async () => { calls += 1; return []; }, controller.signal), (error) => error === reason);
  assert.equal(calls, 1);
});

test("aborting the bounded backoff prevents a second SELECT", async () => {
  const f = fixture(delay);
  const controller = new AbortController();
  let calls = 0;
  const pending = f.read("active", async () => { calls += 1; throw new Error("timeout exceeded when trying to connect"); }, controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  await rejected;
  assert.equal(calls, 1);
  assert.deepEqual(f.waits, [200]);
});

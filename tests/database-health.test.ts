import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function healthReader(query: () => Promise<unknown>, now: () => number) {
  const exports: { readDatabaseHealth?: () => Promise<{ status: string; latencyMs: number; checkedAt: string }> } = {};
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/database/health.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Date, Promise, performance: { now },
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name.endsWith("/prisma")) return { prisma: { $queryRaw: query } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return exports.readDatabaseHealth!;
}

test("concurrent health polls share one query and reuse its result for 30 seconds", async () => {
  let count = 0;
  let time = 0;
  let release!: () => void;
  const read = healthReader(() => {
    count++;
    return new Promise<void>((resolve) => { release = resolve; });
  }, () => time);
  const polls = Array.from({ length: 100 }, () => read());
  assert.equal(count, 1);
  release();
  const results = await Promise.all(polls);
  assert.equal(results.every((result) => result.status === "ok"), true);
  time = 29_999;
  await read();
  assert.equal(count, 1);
  time = 30_000;
  const expired = read();
  assert.equal(count, 2);
  release();
  await expired;
});

test("a rejected provider is cached without exception details and recovery is rechecked after expiry", async () => {
  let count = 0;
  let time = 0;
  const read = healthReader(async () => {
    if (++count === 1) throw new Error("planLimitReached private-host private-credential");
    return [{ value: 1 }];
  }, () => time);
  const down = await read();
  assert.equal(down.status, "down");
  assert.doesNotMatch(JSON.stringify(down), /planLimitReached|private/);
  time = 29_999;
  assert.equal((await read()).status, "down");
  assert.equal(count, 1);
  time = 30_000;
  assert.equal((await read()).status, "ok");
  assert.equal(count, 2);
});

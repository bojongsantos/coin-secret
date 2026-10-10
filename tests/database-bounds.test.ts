import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { Client, Pool, type PoolConfig } from "pg";
import ts from "typescript";

function adapterConfig(): PoolConfig {
  let config: PoolConfig | undefined;
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "@prisma/adapter-pg": { PrismaPg: class { constructor(value: PoolConfig) { config = value; } } },
    "@/generated/prisma/client": { PrismaClient: class {} },
  };
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/database/prisma.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: {}, process: { env: { DATABASE_URL: "postgresql://test-user:test-password@127.0.0.1/test-database", NODE_ENV: "production" } },
    require: (name: string) => dependencies[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
  });
  assert.ok(config);
  return config;
}

test("database wait limits reach native pg startup parameters without replacing server cancellation with a promise race", () => {
  const config = adapterConfig();
  assert.equal(config.connectionTimeoutMillis, 10_000);
  const client = new Client(config) as unknown as { getStartupConf(): Record<string, unknown> };
  const startup = client.getStartupConf();
  assert.equal(startup.statement_timeout, "15000");
  assert.equal(startup.lock_timeout, "5000");
  assert.equal(config.query_timeout, undefined, "a client callback timeout alone does not cancel an already-sent write");
});

test("the installed pg pool terminates a stalled connection at the configured native deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let destroyed = false;
  class StalledClient extends EventEmitter {
    callback?: (error?: Error) => void;
    connection = { stream: { destroy: () => { destroyed = true; this.callback?.(new Error("socket closed")); } } };
    connect(callback: (error?: Error) => void) { this.callback = callback; }
    end() { this.emit("end"); }
  }
  const pool = new Pool({ ...adapterConfig(), Client: StalledClient } as unknown as PoolConfig);
  let settled = false;
  const pending = pool.connect();
  pending.then(() => { settled = true; }, () => { settled = true; });
  t.mock.timers.tick(9_999);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await assert.rejects(pending, /connection timeout/);
  assert.equal(destroyed, true, "the actual stalled socket is closed, not abandoned in a background promise");
  assert.equal(pool.totalCount, 0);
  await pool.end();
});

test("the installed pg pool removes a waiting checkout when all clients remain busy", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  class ReadyClient extends EventEmitter {
    _queryable = true;
    connect(callback: (error?: Error) => void) { callback(); }
    end(callback?: () => void) { this.emit("end"); callback?.(); }
    ref() {}
    unref() {}
  }
  const pool = new Pool({ ...adapterConfig(), max: 1, Client: ReadyClient } as unknown as PoolConfig);
  const held = await pool.connect();
  const waiting = pool.connect();
  waiting.catch(() => {});
  assert.equal(pool.waitingCount, 1);
  t.mock.timers.tick(10_000);
  await assert.rejects(waiting, /timeout exceeded when trying to connect/);
  assert.equal(pool.waitingCount, 0, "a timed-out request must not remain queued and consume a future client");
  held.release();
  await pool.end();
});

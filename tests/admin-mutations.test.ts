import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as rules from "@/core/domain/access/admin-actions";
import * as origins from "@/shared/lib/trusted-origins";
function load(path: string, dependencies: Record<string, unknown>, extra = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Response, URL, Date, TextDecoder, Uint8Array, process: { env: { NODE_ENV: "production", BETTER_AUTH_URL: "https://coinsecret.io" } }, console,
    require(name: string) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); }, ...extra,
  });
  return exports;
}
const http = load("src/shared/server/http.ts", { "server-only": {}, zod });
const boundary = load("src/shared/server/admin-request.ts", { "server-only": {}, "@/shared/server/http": http, "@/shared/lib/trusted-origins": origins });
const read = boundary.readAdminMutation as (request: Request, schema: zod.ZodType) => Promise<unknown>;
function request(body = "{}", origin = "https://coinsecret.io") { return new Request("http://internal-proxy/admin", { method: "PATCH", body, headers: { origin, "Content-Type": "application/json" } }); }
test("admin mutations trust the configured HTTPS origin behind a reverse proxy", async () => {
  assert.equal(await read(request('{"plan":"PREMIUM"}'), zod.object({ plan: zod.enum(["FREE", "PREMIUM"]) })).then((v) => (v as { plan: string }).plan), "PREMIUM");
});
test("admin mutations reject foreign/missing origins and oversized bodies", async () => {
  for (const origin of ["", "https://attacker.invalid"]) await assert.rejects(read(request("{}", origin), zod.object({})), (e: unknown) => (e as { status: number }).status === 403);
  await assert.rejects(read(request(JSON.stringify({ value: "x".repeat(4096) })), zod.object({})), (e: unknown) => (e as { status: number }).status === 413);
});
test("pagination rejects invalid and excessive pages instead of uncontrolled database offsets", () => {
  const page = boundary.adminPage as (r: Request) => { skip: number; take: number };
  assert.equal(page(new Request("https://coinsecret.io/api?page=2")).skip, 50);
  for (const raw of ["0", "-1", "1.5", "1000000", "x"]) assert.throws(() => page(new Request(`https://coinsecret.io/api?page=${raw}`)));
});
function fixture(options: { actorRole?: string; missing?: boolean; auditFails?: boolean } = {}) {
  let state = { plan: "FREE", end: new Date(0), writes: 0, audits: 0 };
  const prisma = { $transaction: async (work: (tx: unknown) => Promise<unknown>, isolation: { isolationLevel: string }) => {
    assert.equal(isolation.isolationLevel, "Serializable");
    const draft = { ...state };
    const result = await work({
      user: { findUnique: async ({ where }: { where: { id: string } }) => where.id === "actor" ? { role: options.actorRole ?? "ADMIN", emailVerified: true } : options.missing ? null : { role: "USER" }, count: async () => 2,
        update: async ({ data }: { data: { plan: string } }) => { draft.plan = data.plan; draft.writes++; return { id: "target" }; } },
      subscription: { upsert: async ({ update }: { update: { currentPeriodEnd: null; provider: string; cancelAtPeriodEnd: boolean } }) => { assert.equal(update.provider, "admin"); assert.equal(update.cancelAtPeriodEnd, false); draft.end = update.currentPeriodEnd as unknown as Date; } },
      session: { deleteMany: async () => ({ count: 0 }) },
      auditLog: { create: async () => { if (options.auditFails) throw new Error("audit failure"); draft.audits++; } },
    });
    state = draft; return result;
  } };
  const loaded = load("src/infrastructure/admin/mutations.ts", { "server-only": {}, "@/infrastructure/database/prisma": { prisma }, "@/infrastructure/billing/transaction-retry": { withSerializationRetry: (fn: () => Promise<unknown>) => fn() }, "@/core/domain/access/admin-actions": rules, "@/shared/server/http": http });
  return { change: loaded.updateAdminUser as (actor: string, target: string, input: rules.UserChange, ip: null) => Promise<unknown>, state: () => state };
}
test("manual Pro grant clears an expired period and persists its audit atomically", async () => {
  const f = fixture(); await f.change("actor", "target", { plan: "PREMIUM" }, null);
  assert.equal(f.state().plan, "PREMIUM"); assert.equal(f.state().end, null); assert.equal(f.state().audits, 1);
});
test("audit failure rolls back both account and subscription changes", async () => {
  const f = fixture({ auditFails: true }); await assert.rejects(f.change("actor", "target", { plan: "PREMIUM" }, null)); assert.equal(f.state().plan, "FREE"); assert.equal(f.state().writes, 0);
});
test("a concurrently demoted operator loses authority before any write", async () => {
  const f = fixture({ actorRole: "USER" }); await assert.rejects(f.change("actor", "target", { role: "USER" }, null), (e: unknown) => (e as { status: number }).status === 403); assert.equal(f.state().writes, 0);
});
test("an unknown account returns not-found without any writes", async () => {
  const f = fixture({ missing: true }); await assert.rejects(f.change("actor", "target", { plan: "PREMIUM" }, null), (e: unknown) => (e as { status: number }).status === 404); assert.equal(f.state().writes, 0);
});
test("feature gating rejects unknown keys before persistence and denies ordinary users", async () => {
  let wrote = false;
  const dependencies = {
    zod,
    "@/infrastructure/auth/current-user": { requireAdmin: async () => ({ id: "admin" }) },
    "@/infrastructure/database/prisma": {},
    "@/shared/server/http": http,
    "@/shared/server/admin-request": boundary,
    "@/infrastructure/admin/rate-limit": { adminMutationLimiter: { check: () => ({ allowed: true }) } },
    "@/infrastructure/admin/mutations": { updateAdminGate: async () => { wrote = true; return {}; } },
  };
  const put = load("src/app/api/admin/feature-gates/route.ts", dependencies).PUT as (r: Request) => Promise<Response>;
  assert.equal((await put(request('{"feature":"notAFeature","free":true,"premium":true}'))).status, 400);
  assert.equal(wrote, false);
  const blocked = load("src/app/api/admin/feature-gates/route.ts", { ...dependencies, "@/infrastructure/auth/current-user": { requireAdmin: async () => { throw new (http.HttpError as new (status: number, message: string) => Error)(403, "Forbidden"); } } }).PUT as (r: Request) => Promise<Response>;
  assert.equal((await blocked(request())).status, 403);
  assert.equal(wrote, false);
});

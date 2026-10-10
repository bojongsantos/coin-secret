import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Response, URL, Error, TextDecoder, Uint8Array, console,
    require(name: string) {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}

const http = load("src/shared/server/http.ts", { "server-only": {}, zod });
const boundary = load("src/shared/server/admin-request.ts", {
  "server-only": {}, "@/shared/server/http": http,
  "@/shared/lib/trusted-origins": { resolveTrustedOrigins: () => [] },
});

type Query = { skip: number; take: number; orderBy: unknown; where: { archivedAt?: null } };
type Payload = { results: { id: string }[]; page: number; hasMore: boolean };

function fixture(unauthorized = false) {
  const queries: Query[] = [];
  let authCalls = 0;
  const rows = Array.from({ length: 121 }, (_, index) => ({
    id: `result-${String(121 - index).padStart(3, "0")}`,
    symbol: "BTCUSDT", timeframe: "1h", direction: "LONG", confidence: 80,
    entry: 100, target2: 120,
    resultAt: new Date("2026-10-05T00:00:00Z"),
    firstSeenAt: new Date("2026-10-04T00:00:00Z"),
    archivedAt: null as Date | null,
  }));
  rows.unshift({ ...rows[0], id: "archived-result", archivedAt: new Date("2026-10-10T00:00:00Z") });
  const route = load("src/app/api/admin/setup-results/route.ts", {
    "@/infrastructure/auth/current-user": { async requireAdmin() {
      authCalls++;
      if (unauthorized) throw new (http.HttpError as new (status: number, message: string) => Error)(403, "Forbidden");
      return { id: "admin" };
    } },
    "@/infrastructure/database/prisma": { prisma: { trackedSetup: { async findMany(query: Query) {
      queries.push(query);
      const visible = query.where.archivedAt === null ? rows.filter((row) => row.archivedAt === null) : rows;
      return visible.slice(query.skip, query.skip + query.take);
    } } } },
    "@/shared/server/http": http,
    "@/shared/server/admin-request": boundary,
  });
  const get = route.GET as (request: Request) => Promise<Response>;
  return {
    queries, authCalls: () => authCalls,
    get: (page: string) => get(new Request(`https://coinsecret.example/api/admin/setup-results?page=${page}`)),
  };
}

test("setup results page two queries offset 50 and 51 rows with stable newest ordering", async () => {
  const f = fixture();
  const response = await f.get("2");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(f.queries.length, 1);
  assert.equal(f.queries[0].skip, 50);
  assert.equal(f.queries[0].take, 51);
  assert.equal(JSON.stringify(f.queries[0].orderBy), JSON.stringify([{ resultAt: "desc" }, { id: "desc" }]));
  assert.equal(JSON.stringify(f.queries[0].where), JSON.stringify({ resultAt: { not: null }, archivedAt: null }));
  const body = await response.json() as Payload;
  assert.equal(body.page, 2);
  assert.equal(body.results.length, 50);
  assert.equal(body.results[0].id, "result-071");
  assert.equal(body.results.at(-1)?.id, "result-022");
  assert.equal(body.hasMore, true);
});

test("pagination exposes older results beyond the former hundred-row limit", async () => {
  const f = fixture();
  const ids: string[] = [];
  for (const page of [1, 2, 3]) {
    const body = await (await f.get(String(page))).json() as Payload;
    assert.equal(body.page, page);
    assert.equal(body.hasMore, page < 3);
    assert.equal(body.results.length, page < 3 ? 50 : 21);
    ids.push(...body.results.map((row) => row.id));
  }
  assert.equal(ids.length, 121);
  assert.equal(new Set(ids).size, 121);
  assert.equal(ids.at(-1), "result-001");
  assert.equal(ids.includes("archived-result"), false);
});

test("an archived setup cannot be rendered as a result proof by its direct id", async () => {
  let composed = false;
  const route = load("src/app/api/admin/setup-results/[id]/route.ts", {
    "@/core/domain/promo/proof-image": { composeProofImage() { composed = true; return "<svg/>"; } },
    "@/infrastructure/auth/current-user": { async requireAdmin() { return { id: "admin" }; } },
    "@/infrastructure/promo/brand-asset": { async wordmarkDataUri() { return null; } },
    "@/infrastructure/database/prisma": { prisma: { trackedSetup: { async findUnique(query: { where: { id: string; archivedAt?: null } }) {
      assert.equal(query.where.id, "archived-result");
      if (query.where.archivedAt === null) return null;
      return { symbol: "BTCUSDT", snapshots: [{ kind: "RESULT", payload: { entryFilledTime: 1, candles: [{}] } }] };
    } } } },
    "@/shared/server/http": http,
  });
  const get = route.GET as (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  const response = await get(new Request("https://coinsecret.example/api/admin/setup-results/archived-result"), { params: Promise.resolve({ id: "archived-result" }) });
  assert.equal(response.status, 404);
  assert.equal(composed, false);
});

test("invalid pagination is rejected before any setup-results database query", async () => {
  const f = fixture();
  for (const page of ["0", "-1", "1.5", "1000000", "x"]) {
    const response = await f.get(page);
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "INVALID_PAGE");
  }
  assert.equal(f.queries.length, 0);
});

test("unauthorized setup-results requests cannot reach the database", async () => {
  const f = fixture(true);
  assert.equal((await f.get("2")).status, 403);
  assert.equal(f.authCalls(), 1);
  assert.equal(f.queries.length, 0);
});

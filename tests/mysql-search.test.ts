import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as subscription from "@/core/domain/access/subscription";

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, URL, Response,
    require: (name: string) => dependencies[name] ?? {},
  });
  return exports;
}

test("news search uses MySQL-supported string filters with its search collation", async () => {
  let observed: unknown;
  const api = load("src/infrastructure/news/articles.ts", {
    react: { cache: (fn: unknown) => fn },
    "@/infrastructure/database/prisma": { prisma: { newsArticle: { findMany: async (query: unknown) => {
      observed = query;
      if (JSON.stringify(query).includes('"mode":')) throw new Error("Unsupported MySQL string filter mode");
      return [];
    } } } },
  });
  await api.articleList({ q: "BitCoin", category: "", page: 1 });
  assert.match(JSON.stringify(observed), /BitCoin/);
});

test("admin user search normalizes the email branch without changing name search", async () => {
  let observed: unknown;
  const api = load("src/app/api/admin/users/route.ts", {
    "@/infrastructure/auth/current-user": { requireAdmin: async () => ({ id: "admin" }) },
    "@/infrastructure/database/prisma": { prisma: { user: { findMany: async (query: unknown) => { observed = query; return []; } } } },
    "@/shared/server/admin-request": { adminPage: () => ({ page: 1, skip: 0, take: 50 }) },
    "@/core/domain/access/subscription": subscription,
  });
  const response = await api.GET(new Request("https://coinsecret.io/api/admin/users?q=Alice%40Example.com"));
  assert.equal((response as Response).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(observed)).where.OR, [
    { email: { contains: "alice@example.com" } }, { name: { contains: "Alice@Example.com" } },
  ]);
});

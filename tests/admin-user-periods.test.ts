import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as zod from "zod";
import { registrationDomainRisk } from "@/core/domain/identity/registration-email";
import blocklist from "@/config/disposable-email-domains.json";

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Date, Intl, Response, URL, require(name: string) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); },
  });
  return exports;
}

test("admin users display actual access dates, editable expiry, and email verification/risk", () => {
  const users = [
    { id: "trial", name: "Trial", email: "trial@gmail.com", emailVerified: true, emailRisk: null, role: "USER", plan: "PREMIUM", subscription: { status: "ACTIVE", provider: "trial", currentPeriodStart: "2026-10-27T00:00:00Z", currentPeriodEnd: "2026-11-10T00:00:00Z" }, _count: { sessions: 1, payments: 0 } },
    { id: "legacy", name: "Legacy", email: "legacy@example.com", emailVerified: false, emailRisk: "reserved", role: "USER", plan: "PREMIUM", subscription: { status: "ACTIVE", provider: "trial", currentPeriodStart: "2020-01-01T00:00:00Z", currentPeriodEnd: "2020-01-08T00:00:00Z" }, _count: { sessions: 0, payments: 0 } },
    { id: "free", name: "Free", email: "free@maxxspace.com", emailVerified: false, emailRisk: "disposable", role: "USER", plan: "FREE", subscription: null, _count: { sessions: 0, payments: 0 } },
  ];
  const view = load("src/presentation/features/admin/users-module.tsx", { react: React, "react/jsx-runtime": runtime, zod,
    "./admin-data": { isList: () => true, useAdminData: () => ({ data: { users, page: 1, hasMore: false }, loading: false, error: null, reload() {} }), AdminFeedback: () => null, AdminPagination: () => null },
  }).UsersModule as React.ComponentType;
  const html = renderToStaticMarkup(React.createElement(view));
  assert.match(html, /Starts:/); assert.match(html, /Ends:/); assert.match(html, /Expired/);
  assert.match(html, /No expiry/); assert.match(html, /Email verified/); assert.match(html, /Email not verified/);
  assert.match(html, /Reserved email domain/); assert.match(html, /Temporary email domain/);
  assert.match(html, /type="datetime-local"[^>]*aria-label="Access expiry for trial@gmail.com"/);
  assert.equal((html.match(/Save expiry/g) ?? []).length, 3);
  assert.doesNotMatch(html, /14-day trial|7-day trial/, "existing periods must not be relabelled as the new trial length");
});

test("admin user API annotates known risky domains only after admin authorization", async () => {
  let reads = 0;
  const users = [{ email: "old@example.com" }, { email: "old@maxxspace.com" }, { email: "owner@gmail.com" }];
  const deps = { "@/infrastructure/auth/current-user": { requireAdmin: async () => ({ id: "admin" }) }, "@/infrastructure/database/prisma": { prisma: { user: { findMany: async () => { reads++; return users; } } } },
    "@/infrastructure/auth/registration-email": { storedEmailRisk: (email: string) => registrationDomainRisk(email, new Set(blocklist.domains)) },
    "@/shared/server/http": { apiError: () => Response.json({ error: "Forbidden" }, { status: 403 }) }, "@/shared/server/admin-request": { adminPage: () => ({ page: 1, skip: 0, take: 50 }) } };
  const get = load("src/app/api/admin/users/route.ts", deps).GET as (request: Request) => Promise<Response>;
  assert.deepEqual((await (await get(new Request("https://coinsecret.io/api/admin/users"))).json()).users.map((user: { emailRisk: string | null }) => user.emailRisk), ["reserved", "disposable", null]);
  const denied = load("src/app/api/admin/users/route.ts", { ...deps, "@/infrastructure/auth/current-user": { requireAdmin: async () => { throw new Error("Forbidden"); } } }).GET as typeof get;
  assert.equal((await denied(new Request("https://coinsecret.io/api/admin/users"))).status, 403);
  assert.equal(reads, 1);
});

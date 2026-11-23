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
import * as subscriptionRules from "@/core/domain/access/subscription";

function load(path: string, dependencies: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Date, Intl, Response, URL, require(name: string) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); }, ...extra,
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
    "@/core/domain/access/subscription": subscriptionRules,
    "@/infrastructure/auth/registration-email": { storedEmailRisk: (email: string) => registrationDomainRisk(email, new Set(blocklist.domains)) },
    "@/shared/server/http": { apiError: () => Response.json({ error: "Forbidden" }, { status: 403 }) }, "@/shared/server/admin-request": { adminPage: () => ({ page: 1, skip: 0, take: 50 }) } };
  const get = load("src/app/api/admin/users/route.ts", deps).GET as (request: Request) => Promise<Response>;
  assert.deepEqual((await (await get(new Request("https://coinsecret.io/api/admin/users"))).json()).users.map((user: { emailRisk: string | null }) => user.emailRisk), ["reserved", "disposable", null]);
  const denied = load("src/app/api/admin/users/route.ts", { ...deps, "@/infrastructure/auth/current-user": { requireAdmin: async () => { throw new Error("Forbidden"); } } }).GET as typeof get;
  assert.equal((await denied(new Request("https://coinsecret.io/api/admin/users"))).status, 403);
  assert.equal(reads, 1);
});

test("admin plan resolves expired trial and paid periods to FREE without rewriting accounts", async () => {
  const users = [
    { id: "expired-trial", email: "trial@gmail.com", plan: "PREMIUM", subscription: { provider: "trial", currentPeriodEnd: new Date(0) } },
    { id: "expired-paid", email: "paid@gmail.com", plan: "PREMIUM", subscription: { provider: "nowpayments", currentPeriodEnd: new Date(0) } },
    { id: "renewed", email: "renewed@gmail.com", plan: "PREMIUM", subscription: { provider: "nowpayments", currentPeriodEnd: new Date("2099-01-01") } },
    { id: "manual", email: "manual@gmail.com", plan: "PREMIUM", subscription: { provider: "admin", currentPeriodEnd: null } },
    { id: "free", email: "free@gmail.com", plan: "FREE", subscription: null },
  ];
  const get = load("src/app/api/admin/users/route.ts", {
    "@/infrastructure/auth/current-user": { requireAdmin: async () => ({ id: "admin" }) },
    "@/infrastructure/database/prisma": { prisma: { user: { findMany: async () => users } } },
    "@/core/domain/access/subscription": subscriptionRules,
    "@/infrastructure/auth/registration-email": { storedEmailRisk: () => null },
    "@/shared/server/http": { apiError: () => Response.json({ error: "Unexpected failure" }, { status: 500 }) },
    "@/shared/server/admin-request": { adminPage: () => ({ page: 1, skip: 0, take: 50 }) },
  }).GET as (request: Request) => Promise<Response>;
  const response = await get(new Request("https://coinsecret.io/api/admin/users"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.users.map((user: { plan: string }) => user.plan), ["FREE", "FREE", "PREMIUM", "PREMIUM", "FREE"]);
  assert.equal(users[0].plan, "PREMIUM", "resolving access must never downgrade a row after concurrent payment renewal");
  assert.equal(body.users[0].subscription.currentPeriodEnd, new Date(0).toISOString(), "historical dates remain visible");
});

test("an open admin users list refreshes automatically at the next access expiry and on focus", () => {
  const effects: Array<() => (() => void) | undefined> = [];
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const listeners = new Map<string, () => void>();
  let reads = 0;
  let cleared = 0;
  const reload = () => { reads++; };
  const component = load("src/presentation/features/admin/users-module.tsx", {
    react: { ...React, useState: (initial: unknown) => [initial, () => undefined], useEffect: (effect: () => (() => void) | undefined) => effects.push(effect) },
    "react/jsx-runtime": runtime, zod,
    "./admin-data": { isList: () => true, useAdminData: () => ({ data: { users: [
      { id: "future", plan: "PREMIUM", subscription: { currentPeriodEnd: new Date(Date.now() + 60_000).toISOString() }, _count: { sessions: 0, payments: 0 } },
      { id: "free", plan: "FREE", subscription: { currentPeriodEnd: new Date(0).toISOString() }, _count: { sessions: 0, payments: 0 } },
      { id: "manual", plan: "PREMIUM", subscription: null, _count: { sessions: 0, payments: 0 } },
    ], page: 1, hasMore: false }, loading: false, error: null, reload }), AdminFeedback: () => null, AdminPagination: () => null },
  }, { window: {
    setTimeout: (callback: () => void, delay: number) => { timers.push({ callback, delay }); return 1; },
    clearTimeout: () => { cleared++; },
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
    removeEventListener: (event: string) => listeners.delete(event),
  } }).UsersModule as () => unknown;
  component();
  const cleanups = effects.map(effect => effect());
  assert.equal(timers.length, 1);
  assert.ok(timers[0].delay > 58_000 && timers[0].delay <= 60_000);
  timers[0].callback();
  assert.equal(reads, 1);
  listeners.get("focus")?.();
  assert.equal(reads, 2, "returning to a suspended tab refreshes the authoritative server plan");
  for (const cleanup of cleanups) cleanup?.();
  assert.equal(cleared, 1);
  assert.equal(listeners.size, 0);
});

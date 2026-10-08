import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
import * as zod from "zod";
import { resolveTrustedOrigins } from "@/shared/lib/trusted-origins";
import { sessionDeadline, sessionLimits } from "@/core/domain/identity/session-policy";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";

const minute = 60_000;
const hour = 60 * minute;
const initialTime = Date.UTC(2026, 9, 8, 0);
type Session = { id: string; createdAt: Date; updatedAt: Date; expiresAt: Date };
type Result = { session: Session; user: { id: string; role: string; emailVerified: boolean } };
type Filter = { id: string; createdAt?: { gt: Date; lte?: Date }; updatedAt?: { gt: Date; lte?: Date }; expiresAt?: { gt: Date; lte?: Date }; OR?: Array<Record<string, { lte: Date }>> };

function load(path: string, dependencies: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Request, Response, Headers, URL, console,
    require(name: string) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); },
    ...extra,
  });
  return exports;
}

function boundary(role = "USER") {
  let now = initialTime;
  let row: Result | null = { session: { id: "fixture-session", createdAt: new Date(now), updatedAt: new Date(now), expiresAt: new Date(now + 7 * 24 * hour) }, user: { id: "fixture-user", role, emailVerified: true } };
  let afterRead: (() => void) | undefined;
  let beforeUpdate: (() => void) | undefined;
  const reads: unknown[] = [];
  const deletes: Filter[] = [];
  const writes: Filter[] = [];
  class ClockDate extends Date {
    constructor(value?: number | string | Date) { super(value === undefined ? now : new Date(value).getTime()); }
    static now() { return now; }
  }
  const matches = (where: Filter) => {
    if (!row || where.id !== row.session.id) return false;
    if (where.OR) return where.OR.some((condition) => Object.entries(condition).some(([key, predicate]) => row!.session[key as keyof Session] instanceof Date && (row!.session[key as keyof Session] as Date).getTime() <= predicate.lte.getTime()));
    return (['createdAt', 'updatedAt', 'expiresAt'] as const).every((key) => !where[key] || row!.session[key].getTime() > where[key]!.gt.getTime());
  };
  const adapter = load("src/infrastructure/auth/active-session.ts", {
    "server-only": {},
    "@/core/domain/identity/session-policy": { sessionDeadline, sessionLimits },
    "@/infrastructure/auth/auth": { auth: { api: { getSession: async (query: unknown) => {
      reads.push(query);
      const snapshot = row ? { session: { ...row.session }, user: { ...row.user } } : null;
      const action = afterRead; afterRead = undefined; action?.();
      return snapshot;
    } } } },
    "@/infrastructure/database/prisma": { prisma: { session: {
      deleteMany: async ({ where }: { where: Filter }) => { deletes.push(where); const count = matches(where) ? 1 : 0; if (count) row = null; return { count }; },
      updateMany: async ({ where, data }: { where: Filter; data: { updatedAt: Date } }) => {
        writes.push(where); const action = beforeUpdate; beforeUpdate = undefined; action?.();
        const count = matches(where) ? 1 : 0; if (count) row!.session.updatedAt = data.updatedAt; return { count };
      },
    } } },
  }, { Date: ClockDate });
  const get = adapter.getActiveSession as (headers: Headers) => Promise<Result | null>;
  const activity = adapter.recordSessionActivity as (headers: Headers) => Promise<Result | null>;
  return {
    get: () => get(new Headers()), activity: () => activity(new Headers()), reads, deletes, writes,
    advance: (ms: number) => { now += ms; },
    row: () => row,
    afterRead: (action: () => void) => { afterRead = action; },
    beforeUpdate: (action: () => void) => { beforeUpdate = action; },
  };
}

test("background reads never renew idle activity and reject at the exact deadline", async () => {
  for (const role of ["USER", "ADMIN"]) {
    const f = boundary(role);
    const initialActivity = f.row()!.session.updatedAt.getTime();
    f.advance(sessionLimits(role).idleMs - 1);
    assert.ok(await f.get());
    assert.ok(await f.get());
    assert.equal(f.row()!.session.updatedAt.getTime(), initialActivity);
    assert.equal(f.writes.length, 0);
    f.advance(1);
    assert.equal(await f.get(), null);
    assert.equal(f.row(), null);
    for (const query of f.reads) assert.equal(JSON.stringify(query), JSON.stringify({ headers: {}, query: { disableCookieCache: true, disableRefresh: true } }));
  }
});

test("human activity renews a live session but cannot revive an expired session", async () => {
  const f = boundary();
  f.advance(29 * minute);
  assert.ok(await f.activity());
  const touched = f.row()!.session.updatedAt.getTime();
  f.advance(29 * minute);
  assert.ok(await f.get());
  assert.equal(f.row()!.session.updatedAt.getTime(), touched);
  f.advance(minute);
  assert.equal(await f.activity(), null);
  assert.equal(f.writes.length, 1);
  assert.equal(f.row(), null);
});

test("session expiry cannot be bypassed by a touch crossing idle or absolute expiry", async () => {
  for (const type of ["idle", "absolute"] as const) {
    const f = boundary();
    if (type === "absolute") {
      f.advance(24 * hour - minute);
      f.row()!.session.updatedAt = new Date(initialTime + 24 * hour - minute);
    }
    f.beforeUpdate(() => f.advance(type === "idle" ? 30 * minute : minute));
    // A request timestamp is captured before the DB write. Expiry is enforced
    // again on the next read; the absolute deadline is never moved by a touch.
    await f.activity();
    assert.equal(await f.get(), null);
    assert.equal(f.row(), null);
  }
});

test("a concurrent legitimate activity update is not deleted by a stale expiry read", async () => {
  const f = boundary();
  f.advance(30 * minute);
  f.afterRead(() => { f.row()!.session.updatedAt = new Date(initialTime + 30 * minute); });
  assert.ok(await f.get());
  assert.ok(f.row());
  assert.equal(f.deletes.length, 1);
  assert.equal(f.reads.length, 2);
});

test("a session revoked while an activity request is in flight is never recreated", async () => {
  const f = boundary();
  f.beforeUpdate(() => { f.row()!.session.id = "another-session"; });
  assert.equal(await f.activity(), null);
});

test("unverified users cannot keep a session alive through the activity endpoint", async () => {
  const f = boundary();
  f.row()!.user.emailVerified = false;
  assert.equal(await f.activity(), null);
  assert.equal(f.writes.length, 0);
});

test("legacy sessions older than the new absolute policy are revoked on access", async () => {
  for (const role of ["USER", "ADMIN"]) {
    const f = boundary(role);
    f.advance(sessionLimits(role).absoluteMs);
    f.row()!.session.updatedAt = new Date(initialTime + sessionLimits(role).absoluteMs);
    assert.equal(await f.get(), null);
    assert.equal(f.row(), null);
  }
});

test("native auth GET and mutation handlers cannot consume an expired cookie session", async () => {
  const f = boundary();
  const http = load("src/shared/server/http.ts", { "server-only": {}, zod }, { TextDecoder, Uint8Array });
  const seen: Array<Result | null> = [];
  const delegate = () => { seen.push(f.row()); return new Response(null, { status: f.row() ? 200 : 401 }); };
  const route = load("src/app/api/auth/[...all]/route.ts", {
    "better-auth/next-js": { toNextJsHandler: () => ({ GET: delegate, POST: delegate }) },
    "node:crypto": { createHash },
    "@/core/application/rate-limit/fixed-window": { createFixedWindowLimiter },
    "@/infrastructure/auth/auth": { auth: {} },
    "@/infrastructure/auth/active-session": { getActiveSession: f.get },
    "@/shared/server/http": http,
  }, { process: { env: { NODE_ENV: "production" } }, TextDecoder, Uint8Array });
  f.advance(30 * minute);
  const get = route.GET as (request: Request) => Promise<Response>;
  const post = route.POST as (request: Request) => Promise<Response>;
  const headers = { cookie: "__Secure-coinsecret.session_token=fixture", "content-type": "application/json" };
  assert.equal((await get(new Request("https://coinsecret.example.invalid/api/auth/get-session?disableRefresh=false", { headers }))).status, 401);
  assert.equal((await post(new Request("https://coinsecret.example.invalid/api/auth/change-password", { method: "POST", headers, body: JSON.stringify({ currentPassword: "fixture-current-password", newPassword: "fixture-new-password" }) }))).status, 401);
  assert.deepEqual(seen, [null, null]);
});

test("session activity reads do not write and forged origin or payload cannot renew a session", async () => {
  let writes = 0;
  const valid: Result = { session: { id: "session", createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + hour) }, user: { id: "user", role: "USER", emailVerified: true } };
  const http = load("src/shared/server/http.ts", { "server-only": {}, zod }, { TextDecoder, Uint8Array });
  const mutations = load("src/shared/server/admin-request.ts", {
    "server-only": {}, "@/shared/server/http": http, "@/shared/lib/trusted-origins": { resolveTrustedOrigins },
  }, { process: { env: { NODE_ENV: "production", BETTER_AUTH_URL: "https://coinsecret.example.invalid" } } });
  const route = load("src/app/api/session/activity/route.ts", {
    zod,
    "@/infrastructure/auth/active-session": { getActiveSession: async () => valid, recordSessionActivity: async () => { writes++; return valid; } },
    "@/core/domain/identity/session-policy": { sessionDeadline },
    "@/shared/server/admin-request": mutations, "@/shared/server/http": http,
  });
  const get = route.GET as (request: Request) => Promise<Response>;
  const post = route.POST as (request: Request) => Promise<Response>;
  const url = "https://coinsecret.example.invalid/api/session/activity";
  const read = await get(new Request(url));
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "no-store");
  assert.equal(writes, 0);
  for (const headers of [
    {}, { origin: "https://attacker.example.invalid" },
    { origin: "https://coinsecret.example.invalid", "sec-fetch-site": "cross-site" },
  ] as HeadersInit[]) {
    assert.equal((await post(new Request(url, { method: "POST", body: "{}", headers: { "content-type": "application/json", ...headers } }))).status, 403);
  }
  const headers = { origin: "https://coinsecret.example.invalid", "content-type": "application/json" };
  for (const [body, status] of [[JSON.stringify({ role: "ADMIN", idleMs: 999999999 }), 400], [JSON.stringify({ x: "y".repeat(4096) }), 413]] as const) {
    assert.equal((await post(new Request(url, { method: "POST", body, headers }))).status, status);
  }
  assert.equal(writes, 0);
  assert.equal((await post(new Request(url, { method: "POST", body: "{}", headers }))).status, 200);
  assert.equal(writes, 1);
});

function clientHook() {
  let now = initialTime;
  let deadline = now + 30 * minute;
  let offline = false;
  let nextId = 1;
  let cleanup: (() => void) | undefined;
  const requests: string[] = [];
  const redirects: string[] = [];
  let expirations = 0;
  const listeners = new Map<string, Set<(event: { isTrusted: boolean }) => void>>();
  const timers = new Map<number, { at: number; interval?: number; callback: () => void }>();
  const addEventListener = (name: string, callback: (event: { isTrusted: boolean }) => void) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(callback);
  };
  const removeEventListener = (name: string, callback: (event: { isTrusted: boolean }) => void) => listeners.get(name)?.delete(callback);
  const timer = (callback: () => void, delay: number, interval?: number) => {
    const id = nextId++; timers.set(id, { at: now + delay, callback, interval }); return id;
  };
  const document = { visibilityState: "visible", addEventListener, removeEventListener };
  const hook = load("src/presentation/hooks/use-session-activity.ts", {
    react: { useEffect: (effect: () => () => void) => { cleanup = effect(); } },
    "next/navigation": { usePathname: () => "/account", useRouter: () => ({ replace: (path: string) => redirects.push(path), refresh() {} }) },
    "@/infrastructure/auth/auth-client": { notifyAuthStateChanged() {} },
  }, {
    Date: { now: () => now }, document, window: { addEventListener, removeEventListener },
    AbortSignal: { timeout: () => new AbortController().signal },
    setTimeout: (callback: () => void, delay: number) => timer(callback, delay), clearTimeout: (id: number) => timers.delete(id),
    setInterval: (callback: () => void, delay: number) => timer(callback, delay, delay), clearInterval: (id: number) => timers.delete(id),
    fetch: async (_url: string, options: { method: string }) => {
      requests.push(options.method);
      if (offline) throw new Error("Network offline");
      if (options.method === "POST") deadline = now + 30 * minute;
      return { ok: true, status: 200, json: async () => ({ deadline, serverNow: now }) };
    },
  }).useSessionActivity as (authenticated: boolean, onExpired?: () => void) => void;
  hook(true, () => { expirations++; });
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return {
    requests, redirects, document, flush,
    expirations: () => expirations,
    offline: () => { offline = true; },
    event: (name: string, isTrusted = true) => { for (const callback of listeners.get(name) ?? []) callback({ isTrusted }); },
    extendInAnotherTab: (milliseconds: number) => { deadline += milliseconds; },
    stop: () => cleanup?.(),
    advance: async (milliseconds: number) => {
      await flush();
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, value] = due;
        now = value.at;
        if (value.interval) value.at += value.interval; else timers.delete(id);
        value.callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

test("background timers, focus and synthetic input never POST human session activity", async () => {
  const f = clientHook();
  await f.flush();
  f.event("focus"); f.event("visibilitychange"); f.event("pointermove", false);
  await f.advance(29 * minute);
  assert.ok(f.requests.length > 1);
  assert.equal(f.requests.every((method) => method === "GET"), true);
  assert.equal(f.redirects.length, 0);
  f.stop();
});

test("trusted visible human input renews activity while hidden-tab input does not", async () => {
  const f = clientHook();
  await f.flush();
  f.document.visibilityState = "hidden";
  f.event("keydown");
  await f.advance(minute);
  assert.equal(f.requests.includes("POST"), false);
  f.document.visibilityState = "visible";
  f.event("pointerdown");
  await f.advance(0);
  assert.equal(f.requests.filter((method) => method === "POST").length, 1);
  f.stop();
});

test("a known session deadline signs the client out even when revalidation is offline", async () => {
  const f = clientHook();
  await f.flush();
  f.offline();
  await f.advance(30 * minute + 20);
  assert.deepEqual(f.redirects, ["/login?next=%2Faccount"]);
  assert.equal(f.expirations(), 1);
  assert.equal(f.requests.includes("POST"), false);
  f.stop();
});

test("deadline revalidation observes another tab's genuine activity without logging it out", async () => {
  const f = clientHook();
  await f.flush();
  f.extendInAnotherTab(30 * minute);
  await f.advance(30 * minute + 20);
  assert.equal(f.redirects.length, 0);
  assert.equal(f.requests.includes("POST"), false);
  f.stop();
});

test("expired private page content is unmounted offline until a new authenticated response", async () => {
  type View = { type: unknown; props: Record<string, unknown> };
  function contains(value: unknown, wanted: unknown): boolean {
    if (value === wanted) return true;
    if (Array.isArray(value)) return value.some((child) => contains(child, wanted));
    if (!value || typeof value !== "object" || !("props" in value)) return false;
    return contains((value as View).props.children, wanted);
  }
  const state: unknown[] = [];
  const effects: Array<() => void> = [];
  const listeners = new Map<string, () => void>();
  const refs: Array<{ current: unknown }> = [];
  let stateCursor = 0;
  let refCursor = 0;
  let mounting = true;
  let pathname = "/account";
  let offline = false;
  let authenticated = true;
  let delayNext = false;
  let resolveStale: ((response: unknown) => void) | undefined;
  let onExpired: (() => void) | undefined;
  const changed = "fixture-auth-state-changed";
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const provider = load("src/presentation/features/access/plan-provider.tsx", {
    react: {
      createContext: () => ({ Provider: "provider" }), useContext() {},
      useCallback: (callback: unknown) => callback, useMemo: (callback: () => unknown) => callback(),
      useEffect: (effect: () => void) => { if (mounting) effects.push(effect); },
      useRef: (initial: unknown) => { const index = refCursor++; refs[index] ??= { current: initial }; return refs[index]; },
      useState: (initial: unknown) => {
        const index = stateCursor++;
        if (index === state.length) state.push(initial);
        return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? (value as (previous: unknown) => unknown)(state[index]) : value; }];
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/navigation": { usePathname: () => pathname }, "next/link": { default: "link" },
    "@/core/domain/access/gating": { hasFeature: () => false },
    "@/infrastructure/auth/auth-client": { AUTH_STATE_CHANGED_EVENT: changed },
    "@/presentation/hooks/use-session-activity": { useSessionActivity: (_authenticated: boolean, expire: () => void) => { onExpired = expire; } },
  }, {
    window: { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) },
    fetch: async () => {
      if (offline) throw new Error("Offline");
      if (delayNext) {
        delayNext = false;
        return new Promise((resolve) => { resolveStale = resolve; });
      }
      return { ok: true, json: async () => ({ authenticated, plan: "free", access: {} }) };
    },
  }).PlanProvider as (props: { children: unknown }) => unknown;
  const secret = { type: "private-account-content", props: { children: "Sensitive profile" } };
  const render = (children: unknown = secret) => { stateCursor = 0; refCursor = 0; return provider({ children }); };
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  render();
  mounting = false;
  effects.forEach((effect) => effect());
  await flush();
  assert.equal(contains(render(), secret), true);
  offline = true;
  listeners.get(changed)?.();
  await flush();
  assert.equal(((render() as View).props.value as { authenticated: boolean }).authenticated, true,
    "An offline access read must keep the session deadline monitor alive");
  offline = false;
  delayNext = true;
  listeners.get(changed)?.();
  await flush();
  offline = true;
  assert.ok(onExpired, "Provider gives the hook a local expiry callback");
  onExpired();
  resolveStale?.({ ok: true, json: async () => ({ authenticated: true, plan: "free", access: {} }) });
  await flush();
  assert.equal(contains(render(), secret), false, "Private children disappear even if navigation cannot finish offline");
  listeners.get(changed)?.();
  await flush();
  assert.equal(contains(render(), secret), false);
  const login = { type: "public-login-form", props: {} };
  pathname = "/login";
  assert.equal(contains(render(login), login), true, "Expiry lock still permits signing in again");
  pathname = "/account";
  offline = false;
  authenticated = false;
  listeners.get(changed)?.();
  await flush();
  assert.equal(contains(render(), secret), false, "An anonymous response cannot clear the expiry lock");
  authenticated = true;
  listeners.get(changed)?.();
  await flush();
  assert.equal(contains(render(), secret), true, "A new authenticated server response unlocks the private page");
  delayNext = true;
  listeners.get(changed)?.();
  await flush();
  listeners.get(changed)?.();
  await flush();
  assert.equal(((render() as View).props.value as { authenticated: boolean }).authenticated, true);
  resolveStale?.({ ok: true, json: async () => ({ authenticated: false, plan: "free", access: {} }) });
  await flush();
  assert.equal(((render() as View).props.value as { authenticated: boolean }).authenticated, true,
    "An older anonymous response cannot overwrite the new login or disable its session monitor");
  authenticated = false;
  listeners.get(changed)?.();
  await flush();
  assert.equal(contains(render(), secret), false, "A current authoritative anonymous response locks an authenticated private page");
});

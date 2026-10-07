import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash, randomBytes } from "node:crypto";
import ts from "typescript";
import * as zod from "zod";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";

function load(path: string, dependencies: Record<string, unknown>, extra = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Response, Request, Headers, URL, TextDecoder, Uint8Array, console,
    process: { env: { NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:3000" } },
    require(name: string) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); }, ...extra,
  });
  return exports;
}
const http = load("src/shared/server/http.ts", { "server-only": {}, zod });
function boundary() {
  const seen: unknown[] = [];
  const requests: Request[] = [];
  const route = load("src/app/api/auth/[...all]/route.ts", {
    "better-auth/next-js": { toNextJsHandler: () => ({ GET: () => new Response(), POST: async (request: Request) => { requests.push(request); seen.push(await request.json()); return new Response(null, { status: 204 }); } }) },
    "node:crypto": { createHash },
    "@/core/application/rate-limit/fixed-window": { createFixedWindowLimiter },
    "@/infrastructure/auth/auth": { auth: {} },
    "@/shared/server/http": http,
  });
  return { post: route.POST as (request: Request) => Promise<Response>, seen, requests };
}
const request = (path: string, body: string, headers: HeadersInit = {}) => new Request(`http://localhost:3000/api/auth/${path}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

test("auth accepts framework-wrapped requests and preserves security context after its bounded read", async () => {
  const f = boundary();
  const controller = new AbortController();
  const body = { email: "wrapper@example.invalid", password: "unchanged pasted password" };
  const original = new Request("http://localhost:3000/api/auth/sign-in/email?callback=account", {
    method: "POST", body: JSON.stringify(body), signal: controller.signal,
    headers: { "content-type": "application/json", "content-length": "1", cookie: "session=fixture", origin: "https://coinsecret.example.invalid", "x-forwarded-for": "192.0.2.1" },
    credentials: "include", cache: "no-store", redirect: "manual", mode: "same-origin",
    referrer: "http://localhost:3000/login", referrerPolicy: "same-origin", integrity: "", keepalive: true,
  });
  // A wrapper exposes valid Web Request getters but does not own native
  // private fields, matching the Next.js development request failure.
  const wrapped = new Proxy(original, { get(target, property) {
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal((await f.post(wrapped)).status, 204);
  assert.deepEqual(f.seen[0], body);
  const delegated = f.requests[0];
  for (const property of ["url", "method", "credentials", "cache", "redirect", "mode", "referrer", "referrerPolicy", "integrity", "keepalive"] as const) {
    assert.equal(delegated[property], original[property]);
  }
  for (const header of ["cookie", "origin", "x-forwarded-for", "content-type"]) {
    assert.equal(delegated.headers.get(header), original.headers.get(header));
  }
  assert.equal(delegated.headers.get("content-length"), null);
  assert.equal(delegated.signal.aborted, false);
  controller.abort();
  assert.equal(delegated.signal.aborted, true);
});

test("auth bounds chunked or dishonest-length JSON before delegation", async () => {
  const f = boundary();
  for (const headers of [{}, { "content-length": "1" }] as HeadersInit[]) {
    assert.equal((await f.post(request("sign-in/email", JSON.stringify({ email: "test@example.invalid", password: "x".repeat(65536) }), headers))).status, 413);
  }
  assert.equal(f.seen.length, 0);
  assert.equal((await f.post(request("sign-in/email", "not JSON"))).status, 400);
  assert.equal((await f.post(request("sign-in/email", "{}", { "content-type": "text/plain" }))).status, 415);
});
test("auth preserves valid delegated JSON and limits sign-in by normalized email", async () => {
  const f = boundary();
  const body = { email: "Account@Example.invalid", password: "same paste value", callbackURL: "/dashboard" };
  assert.equal((await f.post(request("sign-in/email", JSON.stringify(body)))).status, 204);
  assert.equal(JSON.stringify(f.seen[0]), JSON.stringify(body));
  for (let i = 0; i < 7; i++) assert.equal((await f.post(request("sign-in/email", JSON.stringify({ ...body, email: "account@example.invalid" })))).status, 204);
  assert.equal((await f.post(request("sign-in/email", JSON.stringify(body)))).status, 429);
});
test("production refuses demo authentication and reset while regular accounts remain usable", async () => {
  const f = boundary();
  for (const path of ["sign-in/email", "request-password-reset", "sign-up/email", "email-otp/verify-email"]) {
    assert.equal((await f.post(request(path, JSON.stringify({ email: "premium@coinsecret.local" })))).status, 400);
  }
  assert.equal(f.seen.length, 0);
  assert.equal((await f.post(request("request-password-reset", JSON.stringify({ email: "real@example.invalid" })))).status, 204);
});

test("actual auth configuration disables unused OTP paths and retains verify-then-login", async () => {
  const sent: { email: string; html: string }[] = [];
  const configured = load("src/infrastructure/auth/auth.ts", {
    "server-only": {}, "better-auth": { betterAuth: (options: unknown) => options },
    "better-auth/adapters/prisma": { prismaAdapter: () => undefined }, "better-auth/plugins": { emailOTP },
    "@/infrastructure/database/prisma": { prisma: {} },
    "@/infrastructure/email/email-service": { sendTransactionalEmail: async (mail: { email: string; html: string }) => sent.push(mail) },
    "@/infrastructure/auth/local-addresses": { localIPv4Addresses: () => [] },
    "@/shared/lib/trusted-origins": { resolveTrustedOrigins: () => ["http://localhost:3000"] },
  }).auth as Parameters<typeof betterAuth>[0];
  const instance = betterAuth({ ...configured, secret: randomBytes(32).toString("base64"), rateLimit: { enabled: false } });
  const email = "verify-flow@example.invalid";
  const password = randomBytes(24).toString("base64");
  const send = (path: string, body: object) => instance.handler(request(path, JSON.stringify(body), { origin: "http://localhost:3000" }));
  const signup = await send("sign-up/email", { email, password, name: "Test" });
  assert.equal(signup.status, 200);
  assert.equal(signup.headers.get("set-cookie"), null);
  assert.equal((await send("sign-in/email", { email, password })).status, 403);
  const otp = sent.at(-1)?.html.match(/<strong>(\d{6})<\/strong>/)?.[1];
  assert.ok(otp);
  for (const path of configured?.disabledPaths ?? []) {
    assert.equal((await send(path.replace(/^\//, ""), { email, otp, type: "email-verification" })).status, 404);
  }
  const verified = await send("email-otp/verify-email", { email, otp });
  assert.equal(verified.status, 200);
  assert.equal(verified.headers.get("set-cookie"), null);
  const login = await send("sign-in/email", { email, password });
  assert.equal(login.status, 200);
  assert.ok(login.headers.get("set-cookie"));
  const before = sent.length;
  assert.equal((await send("request-password-reset", { email, redirectTo: "/reset-password" })).status, 200);
  assert.equal(sent.length, before + 1, "Recovery sends one reset message, not a verification email as well");
});

test("unverified login offers verification without sending mail or creating a session", async () => {
  type View = { type: unknown; props: Record<string, unknown> };
  function nodes(value: unknown): View[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const view = value as View;
    return [view, ...nodes(view.props.children)];
  }
  const state: unknown[] = [];
  const redirects: string[] = [];
  const submitted: Array<{ email: string; password: string }> = [];
  let cursor = 0;
  let notices = 0;
  let code = "EMAIL_NOT_VERIFIED";
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const component = load("src/presentation/features/auth/auth-form.tsx", {
    react: { useState: (initial: unknown) => {
      const index = cursor++;
      if (index === state.length) state.push(initial);
      return [state[index], (value: unknown) => { state[index] = value; }];
    } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/link": { default: "link" },
    "next/navigation": { useRouter: () => ({ replace: (path: string) => redirects.push(path), refresh() {} }), useSearchParams: () => new URLSearchParams() },
    "lucide-react": { Loader2: "loader" },
    "@/infrastructure/auth/auth-client": {
      authClient: { signIn: { email: async (body: { email: string; password: string }) => { submitted.push(body); return { error: { code, message: "Sign-in refused" } }; } } },
      notifyAuthStateChanged: () => { notices++; },
    },
    "@/shared/lib/safe-redirect": { safeRedirectPath: () => "/dashboard" },
    "@/presentation/ui/brand-logo": { BrandLockup: "brand", BRAND_NAME: "CoinSecret" },
    "@/presentation/hooks/use-translate": { useT: () => ({ t: (key: string) => key }) },
    "@/presentation/ui/password-field": { PasswordField: "password" },
  }, { URLSearchParams }).AuthForm as (props: { mode: string }) => unknown;
  const render = () => { cursor = 0; return nodes(component({ mode: "login" })); };
  const input = render().find((view) => view.type === "input" && view.props.type === "email")!;
  (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: " verify+tag@example.invalid " } });
  const password = render().find((view) => view.type === "password")!;
  (password.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "unchanged-test-password" } });
  const submit = () => (render().find((view) => view.type === "form")!.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
  await submit();
  const link = render().find((view) => view.type === "link" && String(view.props.href).startsWith("/verify-email"));
  assert.ok(link);
  assert.equal(link.props.href, "/verify-email?email=verify%2Btag%40example.invalid");
  assert.equal(submitted[0].email, "verify+tag@example.invalid");
  assert.equal(submitted[0].password, "unchanged-test-password");
  assert.equal(redirects.length, 0);
  assert.equal(notices, 0);
  code = "INVALID_EMAIL_OR_PASSWORD";
  await submit();
  assert.equal(render().some((view) => String(view.props.href).startsWith("/verify-email")), false);
  assert.equal(redirects.length, 0);
  assert.equal(notices, 0);
});

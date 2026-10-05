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
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Response, Request, Headers, URL, TextDecoder, Uint8Array, console,
    process: { env: { NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:3000" } },
    require(name: string) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); }, ...extra,
  });
  return exports;
}
const http = load("src/shared/server/http.ts", { "server-only": {}, zod });
function boundary() {
  const seen: unknown[] = [];
  const route = load("src/app/api/auth/[...all]/route.ts", {
    "better-auth/next-js": { toNextJsHandler: () => ({ GET: () => new Response(), POST: async (request: Request) => { seen.push(await request.json()); return new Response(null, { status: 204 }); } }) },
    "node:crypto": { createHash },
    "@/core/application/rate-limit/fixed-window": { createFixedWindowLimiter },
    "@/infrastructure/auth/auth": { auth: {} },
    "@/shared/server/http": http,
  });
  return { post: route.POST as (request: Request) => Promise<Response>, seen };
}
const request = (path: string, body: string, headers: HeadersInit = {}) => new Request(`http://localhost:3000/api/auth/${path}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

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

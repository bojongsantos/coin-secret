import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";
import { isBillingPeriod } from "@/core/domain/billing/plans";

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Response, TextDecoder, Uint8Array,
    require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      if (name === "@/core/domain/billing/refund-access" || name === "@/infrastructure/billing/checkout-reservation") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const http = load("src/shared/server/http.ts", { "server-only": {}, zod });

test("both webhook providers reject oversized JSON before verification or database access", async () => {
  let accessed = false;
  const handler = load("src/infrastructure/billing/notification-handler.ts", {
    "server-only": {},
    "@/shared/server/http": http,
    "@/core/domain/billing/payment-rules": {},
    "@/core/domain/billing/plans": {},
    "@/infrastructure/billing/gateway-factory": { getBillingGateway() { accessed = true; throw new Error("unexpected"); } },
    "@/infrastructure/database/prisma": {},
    "@/infrastructure/billing/transaction-retry": { isSerializationConflict: () => false },
  }).handlePaymentNotification as (req: Request, provider: string) => Promise<Response>;
  for (const provider of ["midtrans", "nowpayments"]) {
    const response = await handler(new Request("http://localhost/webhook", {
      method: "POST", body: JSON.stringify({ data: "x".repeat(65_536) }),
    }), provider);
    const result = await response.json();
    assert.equal(response.status, 413, JSON.stringify(result));
    assert.equal(result.error.code, "PAYLOAD_TOO_LARGE");
  }
  assert.equal(accessed, false);
});

test("a signed callback cannot settle an order owned by another provider", async () => {
  let wrotePayment = false;
  const handler = load("src/infrastructure/billing/notification-handler.ts", {
    "server-only": {},
    "@/shared/server/http": http,
    "@/core/domain/billing/payment-rules": {},
    "@/core/domain/billing/plans": {},
    "@/infrastructure/billing/gateway-factory": {
      getBillingGateway: () => ({
        id: "nowpayments",
        parseAndVerifyNotification: () => ({ orderId: "order-1", paidAmount: "8", paidCurrency: "USD" }),
      }),
    },
    "@/infrastructure/database/prisma": {
      prisma: {
        $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
          payment: {
            findUnique: async () => ({ provider: "midtrans", currency: "USD", amount: 8 }),
            updateMany: async () => { wrotePayment = true; },
          },
        }),
      },
    },
    "@/infrastructure/billing/transaction-retry": {
      isSerializationConflict: () => false,
      withSerializationRetry: (work: () => Promise<unknown>) => work(),
    },
  }).handlePaymentNotification as (req: Request, provider: string) => Promise<Response>;
  const response = await handler(new Request("http://localhost/webhook", {
    method: "POST", body: "{}", headers: { "content-type": "application/json" },
  }), "nowpayments");
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "PROVIDER_MISMATCH");
  assert.equal(wrotePayment, false);
});

test("checkout rejects JSON null before accessing the selected period", async () => {
  const post = load("src/app/api/billing/checkout/route.ts", {
    "node:crypto": {},
    "@/infrastructure/auth/current-user": { requireUser: async () => ({ id: "null-body" }) },
    "@/infrastructure/billing/gateway-factory": {},
    "@/infrastructure/database/prisma": {},
    "@/infrastructure/audit/audit-log": {},
    "@/core/domain/billing/plans": {},
    "@/core/application/rate-limit/fixed-window": { createFixedWindowLimiter },
    "@/shared/server/http": { ...http, readBoundedJson: async () => null },
  }).POST as (req: Request) => Promise<Response>;
  const response = await post(new Request("http://localhost/checkout"));
  assert.equal(response.status, 400);
});

test("checkout rejects missing or unknown periods before creating an invoice", async () => {
  let created = false;
  const post = load("src/app/api/billing/checkout/route.ts", {
    "node:crypto": {},
    "@/infrastructure/auth/current-user": { requireUser: async () => ({ id: "invalid-period" }) },
    "@/infrastructure/billing/gateway-factory": { getBillingGateway() { created = true; throw new Error("unexpected invoice"); } },
    "@/infrastructure/database/prisma": {},
    "@/infrastructure/audit/audit-log": {},
    "@/core/domain/billing/plans": { isBillingPeriod, billingPlan() { throw new Error("unexpected plan"); } },
    "@/core/application/rate-limit/fixed-window": { createFixedWindowLimiter },
    "@/shared/server/http": { ...http, readBoundedJson: async (req: Request) => req.json() },
  }).POST as (req: Request) => Promise<Response>;
  for (const body of [{}, { period: "weekly" }]) {
    const response = await post(new Request("http://localhost/checkout", {
      method: "POST", body: JSON.stringify(body),
    }));
    assert.equal(response.status, 400);
  }
  assert.equal(created, false);
});

test("checkout throttles by authenticated account before reading the body or creating an invoice", async () => {
  let userId = "one";
  let bodyReads = 0;
  const post = load("src/app/api/billing/checkout/route.ts", {
    "node:crypto": {},
    "@/infrastructure/auth/current-user": { requireUser: async () => ({ id: userId }) },
    "@/infrastructure/billing/gateway-factory": {},
    "@/infrastructure/database/prisma": {},
    "@/infrastructure/audit/audit-log": {},
    "@/core/domain/billing/plans": {},
    "@/core/application/rate-limit/fixed-window": { createFixedWindowLimiter },
    "@/shared/server/http": { ...http, readBoundedJson: async () => {
      bodyReads++;
      throw Object.assign(new Error("invalid json"), { status: 400 });
    }, apiError: () => new Response(null, { status: 400 }) },
  }).POST as (req: Request) => Promise<Response>;
  for (let i = 0; i < 5; i++) assert.equal((await post(new Request("http://localhost/checkout"))).status, 400);
  const blocked = await post(new Request("http://localhost/checkout"));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  assert.equal(bodyReads, 5);
  userId = "two";
  assert.equal((await post(new Request("http://localhost/checkout"))).status, 400);
  assert.equal(bodyReads, 6);
});

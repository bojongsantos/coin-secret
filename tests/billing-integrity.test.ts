import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import * as zod from "zod";
import * as rules from "@/core/domain/billing/payment-rules";
import * as plans from "@/core/domain/billing/plans";
import * as protocol from "@/infrastructure/billing/nowpayments/protocol";
import { accessAfterRefund } from "@/core/domain/billing/refund-access";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";
import type { PaymentEvent } from "@/core/application/ports/billing-gateway";

const NOW = Date.parse("2026-10-05T00:00:00Z");
const DAY = 86_400_000;
class FixedDate extends Date {
  constructor(value?: string | number | Date) { super(value === undefined ? NOW : value instanceof Date ? value.getTime() : value); }
  static now() { return NOW; }
}
function load(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Response, Request, Headers, URL, TextDecoder, Uint8Array, Date: FixedDate, AbortSignal,
    process: { env: {} }, ...globals,
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const http = load("src/shared/server/http.ts", { zod });
const HttpError = http.HttpError as new (status: number, message: string, code: string) => Error;
const retries = { withSerializationRetry: (work: () => Promise<unknown>) => work(), isSerializationConflict: () => false };
const time = (offset: number) => new Date(NOW + offset * DAY);
const period = (id: string, start: number, end: number) => ({ id, accessStartsAt: time(start), accessEndsAt: time(end) });

test("refunding a fully consumed purchase preserves a later paid renewal", () => {
  const result = accessAfterRefund(time(20), period("old", -40, -10), [period("new", -10, 20)], time(0));
  assert.equal(result.requiresReview, false);
  assert.equal(result.periodEnd?.getTime(), time(20).getTime());
  assert.equal(result.shifted.length, 0);
});
test("a partial unused old period removes only unused time, preserving all newer paid days", () => {
  const result = accessAfterRefund(time(45), period("old", -15, 15), [period("new", 15, 45)], time(0));
  assert.equal(result.periodEnd?.getTime(), time(30).getTime());
  assert.equal(result.shifted[0].accessStartsAt.getTime(), NOW);
  assert.equal(result.shifted[0].accessEndsAt.getTime() - result.shifted[0].accessStartsAt.getTime(), 30 * DAY);
});
test("refunding a queued latest renewal leaves the earlier purchase active", () => {
  const result = accessAfterRefund(time(45), period("latest", 15, 45), [period("earlier", -15, 15)], time(0));
  assert.equal(result.periodEnd?.getTime(), time(15).getTime());
  assert.equal(result.shifted.length, 0);
});
test("refunding the only active paid period closes access at now", () => {
  const result = accessAfterRefund(time(15), period("only", -15, 15), [], time(0));
  assert.equal(result.requiresReview, false);
  assert.equal(result.periodEnd?.getTime(), NOW);
});
test("missing, overlapping or manual access ledgers require review without removing access", () => {
  for (const remaining of [
    [{ id: "legacy", accessStartsAt: null, accessEndsAt: null }],
    [period("overlap", 0, 45)],
    [period("missing-manual", 15, 30)],
  ]) {
    const result = accessAfterRefund(time(45), period("old", -15, 15), remaining, time(0));
    assert.equal(result.requiresReview, true);
    assert.equal(result.periodEnd?.getTime(), time(45).getTime());
    assert.equal(result.shifted.length, 0);
  }
});

test("a future purchased period cannot erase an unrecorded prefix of current access", () => {
  const result = accessAfterRefund(time(50), period("purchase", 20, 50), [], time(0));
  assert.equal(result.requiresReview, true);
  assert.equal(result.periodEnd?.getTime(), time(50).getTime());
  assert.equal(result.shifted.length, 0);
});

test("gaps between remaining purchased periods preserve access for ledger review", () => {
  const result = accessAfterRefund(time(50), period("refunded", 0, 10), [period("first", 10, 20), period("last", 30, 50)], time(0));
  assert.equal(result.requiresReview, true);
  assert.equal(result.periodEnd?.getTime(), time(50).getTime());
  assert.equal(result.shifted.length, 0);
});

test("overlapping remaining purchases require review even when the refunded period is separate", () => {
  const result = accessAfterRefund(time(50), period("refunded", 0, 10), [period("first", 10, 35), period("last", 25, 50)], time(0));
  assert.equal(result.requiresReview, true);
  assert.equal(result.periodEnd?.getTime(), time(50).getTime());
  assert.equal(result.shifted.length, 0);
});

test("a complete adjacent purchase chain refunds automatically regardless of ledger order", () => {
  const result = accessAfterRefund(time(70), period("refunded", 0, 10), [period("last", 40, 70), period("middle", 10, 40)], time(0));
  assert.equal(result.requiresReview, false);
  assert.equal(result.periodEnd?.getTime(), time(60).getTime());
  const shifted = new Map(result.shifted.map((row) => [row.id, row]));
  assert.equal(shifted.get("middle")!.accessStartsAt.getTime(), NOW);
  assert.equal(shifted.get("middle")!.accessEndsAt.getTime(), time(30).getTime());
  assert.equal(shifted.get("last")!.accessStartsAt.getTime(), time(30).getTime());
  assert.equal(shifted.get("last")!.accessEndsAt.getTime(), time(60).getTime());
});

interface Payment {
  id: string; orderId: string; provider: string; providerTransactionId: string | null; userId: string;
  status: string; rawStatus: string; amount: number; currency: string; planPeriod: string; paidAt: Date | null;
  accessStartsAt: Date | null; accessEndsAt: Date | null; grantedDays: number | null;
}
function payment(id = "p1", status = "PENDING"): Payment {
  return { id, orderId: `CS-${id}`, provider: "nowpayments", providerTransactionId: null, userId: "buyer", status,
    rawStatus: "waiting", amount: 10, currency: "USD", planPeriod: "monthly", paidAt: null,
    accessStartsAt: null, accessEndsAt: null, grantedDays: null };
}
function event(row: Payment, outcome: PaymentEvent["outcome"] = "paid", providerStatus: string = outcome): PaymentEvent {
  return { orderId: row.orderId, paidAmount: "10", paidCurrency: "USD", providerTransactionId: "123456", outcome, providerStatus, raw: {} };
}
function notificationFixture(rows = [payment()], provider = "nowpayments", end: Date | null = null, catalog: typeof plans = plans) {
  let subscription = { provider, plan: "PREMIUM", currentPeriodEnd: end };
  let userPlan = end || provider === "admin" ? "PREMIUM" : "FREE";
  let writes = 0;
  const audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
  let admin = true;
  const tx = {
    payment: {
      findUnique: async ({ where }: { where: { orderId: string } }) => rows.find((row) => row.orderId === where.orderId),
      findMany: async ({ where }: { where: {
        userId: string; status?: string; id?: { not: string };
        OR?: Array<{ status: string; rawStatus?: { startsWith: string } }>;
      } }) => rows.filter((row) => row.userId === where.userId && row.id !== where.id?.not &&
        (where.OR ? where.OR.some((condition) => row.status === condition.status &&
          (!condition.rawStatus || row.rawStatus.startsWith(condition.rawStatus.startsWith))) : row.status === where.status)),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<Payment> }) => {
        const row = rows.find((row) => row.id === where.id && row.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data); writes++; return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Payment> }) => { Object.assign(rows.find((row) => row.id === where.id)!, data); writes++; },
    },
    subscription: {
      findUnique: async () => subscription,
      upsert: async ({ update }: { update: typeof subscription }) => { subscription = { ...subscription, ...update }; writes++; },
      updateMany: async ({ data }: { data: typeof subscription }) => { subscription = { ...subscription, ...data }; writes++; },
    },
    user: {
      findUnique: async () => ({ role: admin ? "ADMIN" : "USER", emailVerified: true }),
      update: async ({ data }: { data: { plan: string } }) => { userPlan = data.plan; writes++; },
    },
    auditLog: { create: async ({ data }: { data: (typeof audits)[number] }) => { audits.push(data); } },
  };
  const functions = load("src/infrastructure/billing/notification-handler.ts", {
    "@/shared/server/http": http, "@/core/domain/billing/payment-rules": rules,
    "@/core/domain/billing/plans": catalog, "@/core/domain/billing/refund-access": { accessAfterRefund },
    "@/infrastructure/billing/gateway-factory": {}, "@/infrastructure/billing/transaction-retry": retries,
    "@/infrastructure/database/prisma": { prisma: { $transaction: async (work: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
      assert.equal(options.isolationLevel, "Serializable"); return work(tx);
    } } },
  });
  return { apply: functions.applyVerifiedPaymentEvent as (value: ReturnType<typeof event>, provider: string, actorId?: string) => Promise<void>,
    rows, audits, subscription: () => subscription, plan: () => userPlan, writes: () => writes, demote: () => { admin = false; } };
}

test("settlement freezes the exact period and repeats never add more access", async () => {
  const fixture = notificationFixture();
  await fixture.apply(event(fixture.rows[0]), "nowpayments");
  const end = fixture.subscription().currentPeriodEnd!.getTime();
  assert.equal(end, time(30).getTime());
  assert.equal(fixture.rows[0].grantedDays, 30);
  assert.equal(fixture.rows[0].accessStartsAt!.getTime(), NOW);
  const writes = fixture.writes();
  await fixture.apply(event(fixture.rows[0]), "nowpayments");
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), end);
  assert.equal(fixture.writes(), writes);
});

test("settlement honors the duration frozen at checkout after the plan catalogue changes", async () => {
  const purchased = { ...payment(), planPeriod: "sixMonth", grantedDays: 180 };
  const fixture = notificationFixture([purchased], "nowpayments", null, {
    ...plans,
    billingPlan: () => { throw new Error("An existing purchase must not be repriced from today's catalogue"); },
  });
  await fixture.apply(event(purchased), "nowpayments");
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), time(180).getTime());
  assert.equal(purchased.grantedDays, 180);
  assert.equal(purchased.accessStartsAt!.getTime(), NOW);
  assert.equal(purchased.accessEndsAt!.getTime(), time(180).getTime());
});

test("refunding a queued renewal cannot erase access retained after an earlier partial refund", async () => {
  const active = { ...payment("active", "SETTLED"), ...period("active", -10, 20), paidAt: time(-10) };
  const queued = { ...payment("queued", "SETTLED"), ...period("queued", 20, 50), paidAt: time(0) };
  const fixture = notificationFixture([active, queued], "nowpayments", time(50));
  await fixture.apply(event(active, "partially_refunded", "partial_refund"), "nowpayments");
  assert.equal(active.status, "SETTLED");
  assert.equal(active.rawStatus, "REFUND_REQUIRES_REVIEW:partial_refund");
  assert.equal(fixture.audits.at(-1)!.metadata.requiresReconciliation, true);
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), time(50).getTime());
  await fixture.apply({ ...event(queued, "refunded"), providerTransactionId: "654321" }, "nowpayments");
  assert.equal(fixture.plan(), "PREMIUM");
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), time(20).getTime());
  await fixture.apply(event(active, "refunded"), "nowpayments");
  assert.equal(fixture.plan(), "FREE");
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), NOW);
  const writes = fixture.writes();
  await fixture.apply(event(active, "refunded"), "nowpayments");
  assert.equal(fixture.writes(), writes);
});

test("a full refund after a partial refund still removes the purchase's unused access", async () => {
  const purchased = { ...payment("partial", "SETTLED"), ...period("partial", -10, 20), paidAt: time(-10) };
  const fixture = notificationFixture([purchased], "nowpayments", time(20));
  await fixture.apply(event(purchased, "partially_refunded", "partial_refund"), "nowpayments");
  assert.equal(fixture.plan(), "PREMIUM");
  await fixture.apply(event(purchased, "refunded"), "nowpayments");
  assert.equal(fixture.plan(), "FREE");
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), NOW);
  const writes = fixture.writes();
  await fixture.apply(event(purchased, "refunded"), "nowpayments");
  assert.equal(fixture.writes(), writes);
});

test("a partial refund before settlement remains held through stale callbacks", async () => {
  for (const outcome of ["pending", "failed", "expired", "canceled"] as const) {
    const fixture = notificationFixture();
    const purchased = fixture.rows[0];
    await fixture.apply(event(purchased, "partially_refunded", "partial_refund"), "nowpayments");
    assert.equal(purchased.status, "PENDING");
    await fixture.apply(event(purchased, outcome), "nowpayments");
    assert.match(purchased.rawStatus, /^REFUND_REQUIRES_REVIEW:/);
    const heldStatus = purchased.status;
    await fixture.apply(event(purchased), "nowpayments");
    assert.equal(purchased.status, heldStatus);
    assert.equal(purchased.accessStartsAt, null);
    assert.equal(purchased.accessEndsAt, null);
    assert.equal(fixture.subscription().currentPeriodEnd, null);
    assert.equal(fixture.plan(), "FREE");
  }
});

test("another refund cannot erase a legacy entitlement that still requires review", async () => {
  const legacy = payment("legacy-active", "SETTLED");
  const queued = { ...payment("queued", "SETTLED"), ...period("queued", 20, 50), paidAt: time(0) };
  const fixture = notificationFixture([legacy, queued], "nowpayments", time(50));
  await fixture.apply(event(legacy, "refunded"), "nowpayments");
  assert.match(legacy.rawStatus, /^REFUND_REQUIRES_REVIEW:/);
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), time(50).getTime());
  await fixture.apply({ ...event(queued, "refunded"), providerTransactionId: "654321" }, "nowpayments");
  assert.equal(fixture.plan(), "PREMIUM");
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), time(50).getTime());
  assert.match(queued.rawStatus, /^REFUND_REQUIRES_REVIEW:/);
  assert.equal(fixture.audits.at(-1)!.metadata.requiresReconciliation, true);
});
test("old refund and replay preserve a newer purchase's remaining paid time", async () => {
  const old = { ...payment("old", "SETTLED"), ...period("old", -40, -10), paidAt: time(-40) };
  const renewal = { ...payment("new", "SETTLED"), ...period("new", -10, 20), paidAt: time(-10) };
  const fixture = notificationFixture([old, renewal], "nowpayments", time(20));
  await fixture.apply(event(old, "refunded"), "nowpayments");
  assert.equal(fixture.plan(), "PREMIUM");
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), time(20).getTime());
  const writes = fixture.writes();
  await fixture.apply(event(old, "refunded"), "nowpayments");
  await fixture.apply(event(old, "paid"), "nowpayments");
  assert.equal(old.status, "REFUNDED");
  assert.equal(fixture.writes(), writes);
});
test("an independent admin grant survives both purchase and refund", async () => {
  const fixture = notificationFixture([payment()], "admin", null);
  await fixture.apply(event(fixture.rows[0]), "nowpayments");
  await fixture.apply(event(fixture.rows[0], "refunded"), "nowpayments");
  assert.equal(fixture.plan(), "PREMIUM");
  assert.equal(fixture.subscription().provider, "admin");
  assert.equal(fixture.subscription().currentPeriodEnd, null);
});
test("legacy and partial refunds are flagged instead of erasing unrelated access", async () => {
  for (const providerStatus of ["refunded", "partial_refund"]) {
    const row = payment("legacy", "SETTLED");
    const fixture = notificationFixture([row], "nowpayments", time(30));
    await fixture.apply(event(row, providerStatus === "partial_refund" ? "partially_refunded" : "refunded", providerStatus), "nowpayments");
    assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), time(30).getTime());
    assert.equal(fixture.plan(), "PREMIUM");
    assert.equal(row.rawStatus, `REFUND_REQUIRES_REVIEW:${providerStatus}`);
    assert.equal(fixture.audits.at(-1)!.metadata.requiresReconciliation, true);
  }
});
test("pending callback captures real payment ID without granting access", async () => {
  const fixture = notificationFixture();
  await fixture.apply(event(fixture.rows[0], "pending", "waiting"), "nowpayments");
  assert.equal(fixture.rows[0].providerTransactionId, "123456");
  assert.equal(fixture.rows[0].status, "PENDING");
  assert.equal(fixture.plan(), "FREE");
});
test("reconciliation rejects a concurrently demoted admin and changed settled transaction IDs", async () => {
  const fixture = notificationFixture();
  fixture.demote();
  await assert.rejects(fixture.apply(event(fixture.rows[0]), "nowpayments", "admin"), /Admin access required/);
  assert.equal(fixture.writes(), 0);
  fixture.rows[0].providerTransactionId = "different";
  fixture.rows[0].status = "SETTLED";
  await assert.rejects(fixture.apply(event(fixture.rows[0]), "nowpayments"), /Payment ID berbeda/);
  assert.equal(fixture.writes(), 0);
});

test("a later authenticated payment attempt can settle the same pending invoice exactly once", async () => {
  const fixture = notificationFixture();
  const purchased = fixture.rows[0];
  await fixture.apply(event(purchased, "pending", "waiting"), "nowpayments");
  assert.equal(purchased.providerTransactionId, "123456");
  const completed = { ...event(purchased), providerTransactionId: "654321" };
  await fixture.apply(completed, "nowpayments");
  assert.equal(purchased.providerTransactionId, "654321");
  assert.equal(purchased.status, "SETTLED");
  assert.equal(fixture.plan(), "PREMIUM");
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), time(30).getTime());
  const writes = fixture.writes();
  await fixture.apply(completed, "nowpayments");
  assert.equal(fixture.writes(), writes);
  assert.equal(fixture.subscription().currentPeriodEnd!.getTime(), time(30).getTime());
});

test("settled, refunded and review-held purchases keep an immutable verified payment ID", async () => {
  for (const status of ["SETTLED", "REFUNDED", "PENDING"]) {
    const purchased = { ...payment("locked", status), providerTransactionId: "123456" };
    if (status === "PENDING") purchased.rawStatus = "REFUND_REQUIRES_REVIEW:partial_refund";
    const fixture = notificationFixture([purchased], "nowpayments", status === "PENDING" ? null : time(30));
    await assert.rejects(fixture.apply({ ...event(purchased), providerTransactionId: "654321" }, "nowpayments"), /Payment ID berbeda/);
    assert.equal(purchased.providerTransactionId, "123456");
    assert.equal(fixture.writes(), 0);
  }
});
test("verified event still checks amount and currency before any entitlement write", async () => {
  for (const overrides of [{ paidAmount: "1" }, { paidCurrency: "EUR" }]) {
    const fixture = notificationFixture();
    await assert.rejects(fixture.apply({ ...event(fixture.rows[0]), ...overrides }, "nowpayments"));
    assert.equal(fixture.writes(), 0);
  }
});

test("checkout bookkeeping failure cannot downgrade a concurrently settled payment", async () => {
  const row = { ...payment(), checkoutUrl: null, checkoutToken: null };
  const post = checkoutFixture(row, async () => { row.status = "SETTLED"; throw new Error("audit unavailable"); });
  const response = await post(new Request("https://coinsecret.test/api/billing/checkout", { method: "POST", body: '{"period":"monthly"}' }));
  assert.equal(response.status, 500);
  assert.equal(row.status, "SETTLED");
});
function checkoutFixture(row: Payment & { checkoutUrl: string | null; checkoutToken: string | null }, audit: () => Promise<void>, gatewayError?: Error, existing = false) {
  return load("src/app/api/billing/checkout/route.ts", {
    "@/infrastructure/auth/current-user": { requireUser: async () => ({ id: "buyer", name: "Test", email: "test@example.test" }) },
    "@/infrastructure/billing/gateway-factory": { getBillingGateway: () => ({ id: "nowpayments", createCheckout: async () => {
      if (gatewayError) throw gatewayError; return { reference: "invoice-1", redirectUrl: "https://nowpayments.io/payment/?iid=1" };
    } }) },
    "@/infrastructure/database/prisma": { prisma: { payment: {
      update: async ({ data }: { data: Partial<typeof row> }) => Object.assign(row, data),
      updateMany: async ({ where, data }: { where: { status: string }; data: Partial<typeof row> }) => {
        if (row.status !== where.status) return { count: 0 }; Object.assign(row, data); return { count: 1 };
      },
    } } },
    "@/infrastructure/audit/audit-log": { writeAuditLog: audit },
    "@/infrastructure/billing/checkout-reservation": { reserveCheckout: async () => ({ payment: row, existing }) },
    "@/core/domain/billing/plans": plans, "@/core/application/rate-limit/fixed-window": { createFixedWindowLimiter }, "@/shared/server/http": http,
  }).POST as (request: Request) => Promise<Response>;
}
test("uncertain invoice creation stays pending and blocks a second invoice", async () => {
  const row = { ...payment(), checkoutUrl: null, checkoutToken: null };
  const first = checkoutFixture(row, async () => {}, new HttpError(502, "uncertain", "PAYMENT_GATEWAY_UNCERTAIN"));
  const request = () => new Request("https://coinsecret.test/checkout", { method: "POST", body: '{"period":"monthly"}' });
  assert.equal((await first(request())).status, 502);
  assert.equal(row.status, "PENDING");
  assert.equal(row.rawStatus, "CHECKOUT_UNCERTAIN");
  const second = checkoutFixture(row, async () => {}, new Error("must not contact provider"), true);
  const result = await second(request());
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, "PAYMENT_REQUIRES_RECONCILIATION");
});
test("definite provider rejection closes only a still-pending checkout", async () => {
  const row = { ...payment(), checkoutUrl: null, checkoutToken: null };
  const post = checkoutFixture(row, async () => {}, new HttpError(502, "rejected", "PAYMENT_GATEWAY_REJECTED"));
  await post(new Request("https://coinsecret.test/checkout", { method: "POST", body: '{"period":"monthly"}' }));
  assert.equal(row.status, "FAILED");
});

test("provider requests have a native ten-second deadline and never retry POST", async () => {
  let requests = 0;
  let deadline = 0;
  const helpers = load("src/infrastructure/billing/provider-http.ts", { "@/shared/server/http": http }, {
    AbortSignal: { timeout: (ms: number) => { deadline = ms; return AbortSignal.abort(); } },
    fetch: async (_url: string, init: RequestInit) => { requests++; assert.ok(init.signal); assert.equal(init.cache, "no-store"); throw new Error("network"); },
  });
  await assert.rejects((helpers.paymentJson as (url: string, init: RequestInit) => Promise<unknown>)("https://provider.test/invoice", { method: "POST" }), /sebelum diperiksa/);
  assert.equal(deadline, 10_000);
  assert.equal(requests, 1);
});
test("unsafe provider checkout URLs and ambiguous HTTP failures fail closed", () => {
  const helpers = load("src/infrastructure/billing/provider-http.ts", { "@/shared/server/http": http });
  const safe = helpers.safeCheckoutUrl as (value: unknown, hosts: string[]) => string | null;
  for (const url of ["javascript:alert(1)", "http://nowpayments.io", "https://nowpayments.io.attacker.test", "https://user:pass@nowpayments.io"]) assert.equal(safe(url, ["nowpayments.io"]), null);
  assert.ok(safe("https://nowpayments.io/payment/?iid=1", ["nowpayments.io"]));
  const failure = helpers.checkoutFailure as (status: number) => { code: string };
  assert.equal(failure(400).code, "PAYMENT_GATEWAY_REJECTED");
  assert.equal(failure(408).code, "PAYMENT_GATEWAY_UNCERTAIN");
  assert.equal(failure(409).code, "PAYMENT_GATEWAY_UNCERTAIN");
  assert.equal(failure(503).code, "PAYMENT_GATEWAY_UNCERTAIN");
});
test("sandbox cannot use production mode, a remote database or production keys", () => {
  class Gateway { readonly id = "stub"; constructor(readonly config: unknown) {} }
  function gateway(env: Record<string, string>) {
    return (load("src/infrastructure/billing/gateway-factory.ts", {
      "@/core/domain/billing/providers": { DEFAULT_PAYMENT_PROVIDER: "nowpayments" },
      "@/infrastructure/billing/midtrans/gateway": { MidtransGateway: Gateway },
      "@/infrastructure/billing/nowpayments/gateway": { NowPaymentsGateway: Gateway }, "@/shared/server/http": http,
    }, { process: { env } }).getBillingGateway as (provider: string) => Gateway)("nowpayments-sandbox");
  }
  const keys = { NOWPAYMENTS_SANDBOX_API_KEY: "dummy-sandbox", NOWPAYMENTS_SANDBOX_IPN_SECRET: "dummy-ipn", BETTER_AUTH_URL: "https://dev.example.test/" };
  assert.throws(() => gateway({ ...keys, NODE_ENV: "production", DATABASE_URL: "postgresql://localhost/coinsecret_sandbox" }), /database lokal terpisah/);
  assert.throws(() => gateway({ ...keys, NODE_ENV: "development", DATABASE_URL: "postgresql://remote.test/coinsecret_sandbox" }), /database lokal terpisah/);
  assert.throws(() => gateway({ ...keys, NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/coinsecret" }), /database lokal terpisah/);
  assert.throws(() => gateway({ NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/coinsecret_test", NOWPAYMENTS_API_KEY: "production-key" }), /NOWPAYMENTS_SANDBOX_API_KEY/);
  const result = gateway({ ...keys, NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/coinsecret_sandbox" });
  assert.deepEqual(JSON.parse(JSON.stringify(result.config)), { apiKey: "dummy-sandbox", ipnSecret: "dummy-ipn", publicUrl: "https://dev.example.test", sandbox: true });
});
test("recursive IPN signatures preserve nested fees and detect nested tampering", () => {
  const payload = { z: [{ z: 2, a: 1 }], fee: { serviceFee: 0.2, currency: "usdt", nested: { z: 2, a: 1 } }, a: 1 };
  const canonical = '{"a":1,"fee":{"currency":"usdt","nested":{"a":1,"z":2},"serviceFee":0.2},"z":[{"a":1,"z":2}]}';
  const expected = crypto.createHmac("sha512", "dummy-ipn").update(canonical).digest("hex");
  assert.equal(protocol.canonicalPayload(payload), canonical);
  assert.equal(protocol.ipnSignature(payload, "dummy-ipn"), expected);
  assert.notEqual(protocol.ipnSignature({ ...payload, fee: { ...payload.fee, serviceFee: 100 } }, "dummy-ipn"), expected);
});

test("reconciliation uses only a real payment ID and never falls back to checkout invoice ID", async () => {
  let fetched = 0;
  const row = { ...payment(), checkoutToken: "invoice-id" };
  const reconcile = reconcileFixture(row, async () => { fetched++; return event(row); });
  await assert.rejects(reconcile("admin", row.id), /actual payment ID/);
  assert.equal(fetched, 0);
});
function reconcileFixture(row: ReturnType<typeof payment> & { checkoutToken?: string }, lookup: (id: string) => Promise<ReturnType<typeof event>>, apply: (event: PaymentEvent, provider: string, actorId: string) => Promise<void> = async () => {}) {
  return load("src/infrastructure/billing/payment-reconciliation.ts", {
    "@/infrastructure/database/prisma": { prisma: { payment: { findUnique: async () => row } } },
    "@/infrastructure/billing/gateway-factory": { getBillingGateway: () => ({ id: "nowpayments", readPaymentStatus: lookup }) },
    "@/infrastructure/billing/notification-handler": { applyVerifiedPaymentEvent: apply }, "@/shared/server/http": http,
    "@/core/domain/billing/payment-rules": rules,
  }).reconcilePayment as (actor: string, id: string, paymentId?: string) => Promise<unknown>;
}
test("reconciliation rejects another order or transaction and missing currency before writing", async () => {
  for (const overrides of [{ orderId: "different-order" }, { providerTransactionId: "different-id" }, { paidCurrency: undefined }]) {
    let applied = false;
    const row = payment();
    const reconcile = reconcileFixture(row, async () => ({ ...event(row), ...overrides }), async () => { applied = true; });
    await assert.rejects(reconcile("admin", row.id, "123456"));
    assert.equal(applied, false);
  }
});
test("matching authenticated reconciliation delegates to the shared transaction", async () => {
  let applied = 0;
  const row = payment(); row.providerTransactionId = "123456";
  const reconcile = reconcileFixture(row, async (id) => { assert.equal(id, "123456"); return event(row); }, async () => { applied++; });
  await reconcile("admin", row.id);
  assert.equal(applied, 1);
});

test("reconciliation can select a new provider payment attempt for an unsettled invoice", async () => {
  const row = payment();
  row.providerTransactionId = "123456";
  let applied = 0;
  const reconcile = reconcileFixture(row, async (id) => {
    assert.equal(id, "654321");
    return { ...event(row), providerTransactionId: id };
  }, async (verified, provider, actorId) => {
    assert.equal(verified.providerTransactionId, "654321");
    assert.equal(verified.orderId, row.orderId);
    assert.equal(provider, "nowpayments");
    assert.equal(actorId, "admin");
    applied++;
  });
  await reconcile("admin", row.id, "654321");
  assert.equal(applied, 1);
});

test("reconciliation cannot switch provider IDs after settlement, refund or a refund hold", async () => {
  for (const status of ["SETTLED", "REFUNDED", "PENDING"]) {
    const row = payment("locked", status);
    row.providerTransactionId = "123456";
    if (status === "PENDING") row.rawStatus = "REFUND_REQUIRES_REVIEW:partial_refund";
    let fetched = 0;
    const reconcile = reconcileFixture(row, async () => { fetched++; return event(row); });
    await assert.rejects(reconcile("admin", row.id, "654321"), /Payment ID differs/);
    assert.equal(fetched, 0);
  }
});

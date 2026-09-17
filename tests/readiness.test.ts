import test from "node:test";
import assert from "node:assert/strict";
import {
  assessReadiness,
  isFullyConfigured,
  missingKeys,
} from "@/core/domain/ops/readiness";

const ALL_KEYS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "MIDTRANS_SERVER_KEY",
  "PREMIUM_PRICE_IDR",
  "BREVO_API_KEY",
  "EMAIL_FROM",
  "CRON_SECRET",
];

function reportFor(id: string, present: string[], provider?: string) {
  const report = assessReadiness(present, provider).find((item) => item.id === id);
  assert.ok(report, `no report for ${id}`);
  return report;
}

test("a fully configured deployment reports everything ready", () => {
  const reports = assessReadiness(ALL_KEYS);
  assert.ok(isFullyConfigured(reports));
  assert.deepEqual(missingKeys(reports), []);
  for (const report of reports) {
    assert.equal(report.level, "ready");
    assert.deepEqual(report.missing, []);
  }
});

test("an empty environment blocks every capability", () => {
  const reports = assessReadiness([]);
  assert.equal(isFullyConfigured(reports), false);
  for (const report of reports) {
    assert.equal(report.level, "blocked");
    assert.deepEqual(report.missing, report.requires);
  }
});

test("a missing payment key is reported as blocking sales", () => {
  // This is the exact state production was found in: everything renders, and
  // only a buyer reaching checkout discovers it.
  const withoutPayments = ALL_KEYS.filter((key) => key !== "MIDTRANS_SERVER_KEY");
  const report = reportFor("payments", withoutPayments);

  assert.equal(report.level, "blocked");
  assert.deepEqual(report.missing, ["MIDTRANS_SERVER_KEY"]);
  assert.match(report.impact, /Premium/);

  // Unrelated capabilities must not be dragged down with it.
  assert.equal(reportFor("alerts", withoutPayments).level, "ready");
  assert.equal(reportFor("database", withoutPayments).level, "ready");
});

test("the payment report follows the provider the deployment actually charges with", () => {
  // Switching providers must move the report with it. Otherwise the panel
  // keeps demanding a key nobody uses while staying silent about the two the
  // active provider cannot charge without.
  const crypto = reportFor("payments", ALL_KEYS, "nowpayments");
  assert.equal(crypto.level, "blocked");
  assert.deepEqual(crypto.missing, ["NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"]);
  assert.match(crypto.name, /nowpayments/);

  const configured = [...ALL_KEYS, "NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"];
  assert.equal(reportFor("payments", configured, "nowpayments").level, "ready");

  // Midtrans keys are irrelevant to a crypto deployment and must not block it.
  const cryptoOnly = configured.filter((key) => key !== "MIDTRANS_SERVER_KEY");
  assert.equal(reportFor("payments", cryptoOnly, "nowpayments").level, "ready");
});

test("an unsupported provider blocks on the variable that selected it", () => {
  // With no key list to check, a typo would otherwise report as fully ready
  // while every checkout answers 503.
  const report = reportFor("payments", ALL_KEYS, "stripe");
  assert.equal(report.level, "blocked");
  assert.deepEqual(report.missing, ["PAYMENT_PROVIDER"]);
});

test("email needs both of its keys before it counts as ready", () => {
  const onlyApiKey = ALL_KEYS.filter((key) => key !== "EMAIL_FROM");
  const partial = reportFor("email", onlyApiKey);

  // A half-configured sender still throws on the first password reset.
  assert.equal(partial.level, "blocked");
  assert.deepEqual(partial.missing, ["EMAIL_FROM"]);
  assert.match(partial.impact, /password/i);

  assert.equal(reportFor("email", ALL_KEYS).level, "ready");
});

test("every capability explains what users lose while it is blocked", () => {
  for (const report of assessReadiness([])) {
    assert.ok(report.requires.length > 0, `${report.id} declares no requirement`);
    assert.ok(
      report.impact.trim().length > 20,
      `${report.id} must say what actually stops working`,
    );
  }
});

test("the report names variables but never carries their values", () => {
  // Reports are logged and sent over the wire, so a value must never ride
  // along with the key that is missing.
  const secret = "sb-mid-server-REALSECRET";
  const reports = assessReadiness(["DATABASE_URL", "CRON_SECRET"]);
  const serialised = JSON.stringify(reports);

  assert.equal(serialised.includes(secret), false);
  assert.ok(serialised.includes("MIDTRANS_SERVER_KEY"), "the key name is what makes it fixable");
});

test("missing keys are listed once even when several capabilities need them", () => {
  const reports = assessReadiness([]);
  const keys = missingKeys(reports);
  assert.equal(new Set(keys).size, keys.length);
  for (const expected of ALL_KEYS) {
    assert.ok(keys.includes(expected), `${expected} should be reported as missing`);
  }
});

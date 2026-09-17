import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPayload,
  ipnSchema,
  ipnSignature,
  outcomeFor,
  signatureMatches,
  toPaymentEvent,
} from "@/infrastructure/billing/nowpayments/protocol";
import { decidePayment } from "@/core/domain/billing/payment-rules";

const IPN_SECRET = "ipn-test-secret";

const IPN = {
  payment_id: 5745459419,
  payment_status: "finished",
  pay_address: "0xabc",
  price_amount: 99000,
  price_currency: "idr",
  pay_amount: 0.0123,
  actually_paid: 0.0123,
  pay_currency: "eth",
  order_id: "CS-1-abcd1234",
  order_description: "Coin Secret Premium 30 hari",
};

/**
 * Produced independently of the implementation, so the canonical form and the
 * HMAC stay locked. Getting either wrong would reject every genuine callback,
 * and that failure only shows up once real money is moving.
 */
const GOLDEN_CANONICAL =
  '{"actually_paid":0.0123,"order_description":"Coin Secret Premium 30 hari","order_id":"CS-1-abcd1234","pay_address":"0xabc","pay_amount":0.0123,"pay_currency":"eth","payment_id":5745459419,"payment_status":"finished","price_amount":99000,"price_currency":"idr"}';
const GOLDEN_SIGNATURE =
  "db39f1fbe464bb93a251681f820b23e5333c658b31d9fa0fe19765f44f2aee02ba5ab0717e5fcb37048be0169be77dd7c4254aa56464dd46aff8ce7afd2d76fd";

test("the payload is canonicalised with its keys sorted", () => {
  assert.equal(canonicalPayload(IPN), GOLDEN_CANONICAL);
  // Key order on the wire must not change the digest.
  const shuffled = Object.fromEntries(Object.entries(IPN).reverse());
  assert.equal(canonicalPayload(shuffled), GOLDEN_CANONICAL);
});

test("the signature is an HMAC-SHA512 over the canonical payload", () => {
  assert.equal(ipnSignature(IPN, IPN_SECRET), GOLDEN_SIGNATURE);
  assert.equal(GOLDEN_SIGNATURE.length, 128);
});

test("a genuine signature is accepted regardless of hex casing", () => {
  const signature = ipnSignature(IPN, IPN_SECRET);
  assert.equal(signatureMatches(signature, GOLDEN_SIGNATURE), true);
  assert.equal(signatureMatches(signature.toUpperCase(), GOLDEN_SIGNATURE), true);
});

test("a forged callback cannot pass verification", () => {
  const expected = ipnSignature(IPN, IPN_SECRET);

  // Without the IPN secret the digest cannot be produced.
  assert.equal(signatureMatches(ipnSignature(IPN, "guessed-secret"), expected), false);

  // Raising the amount or flipping the status re-signs to something else.
  assert.equal(
    signatureMatches(ipnSignature({ ...IPN, price_amount: 1 }, IPN_SECRET), expected),
    false,
  );
  assert.equal(
    signatureMatches(ipnSignature({ ...IPN, payment_status: "waiting" }, IPN_SECRET), expected),
    false,
  );

  // Malformed input is rejected rather than throwing inside the comparison.
  assert.equal(signatureMatches("", expected), false);
  assert.equal(signatureMatches("zz", expected), false);
  assert.equal(signatureMatches(expected.slice(0, 100), expected), false);
});

test("only a finished payment grants access", () => {
  assert.equal(outcomeFor("finished"), "paid");
  assert.equal(decidePayment(outcomeFor("finished")).successful, true);

  // Confirmed means enough on-chain confirmations, not settled to the
  // merchant. Treating it as paid would hand out a plan before the funds land.
  for (const status of ["waiting", "confirming", "confirmed", "sending"]) {
    assert.equal(outcomeFor(status), "pending", status);
    assert.equal(decidePayment(outcomeFor(status)).successful, false, status);
  }
});

test("an underpayment is neither settled nor failed", () => {
  assert.equal(outcomeFor("partially_paid"), "underpaid");
  const decision = decidePayment("underpaid");
  assert.equal(decision.status, "PENDING");
  assert.equal(decision.successful, false);
});

test("terminal failures map onto their own statuses", () => {
  assert.equal(outcomeFor("failed"), "failed");
  assert.equal(outcomeFor("expired"), "expired");
  assert.equal(outcomeFor("refunded"), "refunded");
  assert.equal(decidePayment(outcomeFor("refunded")).status, "REFUNDED");
});

test("an unrecognised status stays pending instead of being guessed at", () => {
  assert.equal(outcomeFor("some_new_status"), "pending");
  assert.equal(outcomeFor("FINISHED"), "paid");
});

test("the event reports the order currency, never the crypto amount", () => {
  const parsed = ipnSchema.parse(IPN);
  const event = toPaymentEvent(parsed);

  // 0.0123 ETH can never be reconciled against a 99000 IDR order; the fiat
  // price is the only figure the amount check can use.
  assert.equal(event.paidAmount, "99000");
  assert.equal(event.paidCurrency, "idr");
  assert.equal(event.orderId, "CS-1-abcd1234");
  assert.equal(event.providerTransactionId, "5745459419");
  assert.equal(event.outcome, "paid");
  assert.equal(event.providerStatus, "finished");
});

test("an underpaid callback still reports the full order amount", () => {
  // Otherwise the webhook would reject it as an amount mismatch and never
  // record that money arrived at all.
  const parsed = ipnSchema.parse({ ...IPN, payment_status: "partially_paid", actually_paid: 0.004 });
  const event = toPaymentEvent(parsed);
  assert.equal(event.paidAmount, "99000");
  assert.equal(event.outcome, "underpaid");
});

test("a callback missing its essential fields is rejected", () => {
  assert.equal(ipnSchema.safeParse({ payment_status: "finished" }).success, false);
  assert.equal(ipnSchema.safeParse({ order_id: "CS-1", price_amount: 1 }).success, false);
  assert.equal(ipnSchema.safeParse({ ...IPN, order_id: "" }).success, false);
  // Unknown fields are kept, so the audit trail records what actually arrived.
  const extra = ipnSchema.parse({ ...IPN, some_new_field: "x" });
  assert.equal((extra as Record<string, unknown>).some_new_field, "x");
});

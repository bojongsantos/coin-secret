import test from "node:test";
import assert from "node:assert/strict";
import {
  midtransSignature,
  notificationSchema,
  outcomeFor,
  signatureMatches,
  toPaymentEvent,
} from "@/infrastructure/billing/midtrans/protocol";

const SERVER_KEY = "SB-Mid-server-TESTKEY";
const ORDER = { orderId: "ORDER-1", statusCode: "200", grossAmount: "99000.00" };

/** Computed independently of the implementation, so the formula stays locked. */
const GOLDEN_SIGNATURE =
  "ae67959de26fff679549ef3fbdd6aaa98d3960e42a614196887e31dca798e34203ed0b9ff142db7a4a30fa0f0f616d2aa0e85849895a81d3c29abfd162c46981";

test("the signature follows the order+status+amount+key formula", () => {
  // Getting the field order wrong would reject every genuine notification, so
  // the expected digest is pinned rather than derived from the same code.
  assert.equal(midtransSignature({ ...ORDER, serverKey: SERVER_KEY }), GOLDEN_SIGNATURE);
  assert.equal(GOLDEN_SIGNATURE.length, 128);
});

test("a genuine signature is accepted", () => {
  const signature = midtransSignature({ ...ORDER, serverKey: SERVER_KEY });
  assert.equal(signatureMatches(signature, GOLDEN_SIGNATURE), true);
  // Different hex casing is still the same digest bytes.
  assert.equal(signatureMatches(signature.toUpperCase(), GOLDEN_SIGNATURE), true);
});

test("a forged notification cannot pass verification", () => {
  const expected = midtransSignature({ ...ORDER, serverKey: SERVER_KEY });

  // Without the server key the digest cannot be produced.
  assert.equal(
    signatureMatches(midtransSignature({ ...ORDER, serverKey: "guessed-key" }), expected),
    false,
  );

  // Each signed field is genuinely covered: changing any one breaks the match.
  const tampered = [
    { ...ORDER, orderId: "ORDER-2" },
    { ...ORDER, statusCode: "201" },
    { ...ORDER, grossAmount: "1.00" },
  ];
  for (const fields of tampered) {
    assert.equal(
      signatureMatches(midtransSignature({ ...fields, serverKey: SERVER_KEY }), expected),
      false,
      "a tampered field must be rejected",
    );
  }
});

test("malformed signatures are refused without throwing", () => {
  const expected = midtransSignature({ ...ORDER, serverKey: SERVER_KEY });
  // timingSafeEqual throws on unequal buffers, so these are filtered first.
  assert.equal(signatureMatches("", expected), false);
  assert.equal(signatureMatches("abcd", expected), false);
  assert.equal(signatureMatches("z".repeat(128), expected), false);
  assert.equal(signatureMatches(expected + "00", expected), false);
});

test("a settlement counts as paid only when gateway and fraud both agree", () => {
  assert.equal(
    outcomeFor({ transaction_status: "settlement", status_code: "200", fraud_status: "accept" }),
    "paid",
  );
  // A card capture that cleared fraud screening is equally valid.
  assert.equal(
    outcomeFor({ transaction_status: "capture", status_code: "200", fraud_status: "accept" }),
    "paid",
  );
  // Midtrans omits fraud_status for payment types it does not screen.
  assert.equal(outcomeFor({ transaction_status: "settlement", status_code: "200" }), "paid");
  assert.equal(
    outcomeFor({ transaction_status: "settlement", status_code: "200", fraud_status: "ACCEPT" }),
    "paid",
    "fraud status casing must not decide whether someone gets a paid plan",
  );
});

test("a settlement under fraud review is held, never treated as paid", () => {
  for (const fraud_status of ["challenge", "deny", "CHALLENGE"]) {
    // Such a payment can still be reversed, and treating it as paid would
    // hand out a plan that was never paid for.
    assert.equal(
      outcomeFor({ transaction_status: "settlement", status_code: "200", fraud_status }),
      "pending",
      "a payment under fraud review must not grant access",
    );
  }
});

test("a settlement the gateway did not confirm is held as pending", () => {
  for (const status_code of ["201", "202", "400", "500", ""]) {
    assert.equal(
      outcomeFor({ transaction_status: "settlement", status_code, fraud_status: "accept" }),
      "pending",
      "only status code 200 may grant access",
    );
  }
});

test("every other Midtrans status maps to one outcome", () => {
  assert.equal(outcomeFor({ transaction_status: "expire", status_code: "200" }), "expired");
  assert.equal(outcomeFor({ transaction_status: "cancel", status_code: "200" }), "canceled");
  assert.equal(outcomeFor({ transaction_status: "refund", status_code: "200" }), "refunded");
  assert.equal(outcomeFor({ transaction_status: "partial_refund", status_code: "200" }), "refunded");
  assert.equal(outcomeFor({ transaction_status: "deny", status_code: "200" }), "failed");
  assert.equal(outcomeFor({ transaction_status: "failure", status_code: "200" }), "failed");
  assert.equal(outcomeFor({ transaction_status: "pending", status_code: "200" }), "pending");
  // An unrecognised status must not be guessed into granting or revoking.
  assert.equal(outcomeFor({ transaction_status: "something_new", status_code: "200" }), "pending");
  assert.equal(outcomeFor({ transaction_status: "", status_code: "200" }), "pending");
});

test("the wire schema rejects payloads that cannot be trusted", () => {
  const valid = {
    order_id: "ORDER-1",
    gross_amount: "99000.00",
    currency: "IDR",
    status_code: "200",
    transaction_status: "settlement",
    signature_key: GOLDEN_SIGNATURE,
  };
  assert.equal(notificationSchema.safeParse(valid).success, true);

  // A short signature could otherwise reach the comparison and throw.
  assert.equal(
    notificationSchema.safeParse({ ...valid, signature_key: "abc" }).success,
    false,
  );
  // A non-numeric amount would compare as NaN further down.
  assert.equal(notificationSchema.safeParse({ ...valid, gross_amount: "free" }).success, false);
  assert.equal(notificationSchema.safeParse({ ...valid, order_id: "" }).success, false);
  assert.equal(notificationSchema.safeParse({}).success, false);
});

test("a verified notification becomes a provider-neutral event", () => {
  const parsed = notificationSchema.parse({
    order_id: "ORDER-1",
    transaction_id: "trx-9",
    gross_amount: "99000.00",
    currency: "IDR",
    status_code: "200",
    transaction_status: "settlement",
    fraud_status: "accept",
    signature_key: GOLDEN_SIGNATURE,
  });

  const event = toPaymentEvent(parsed);

  assert.equal(event.orderId, "ORDER-1");
  assert.equal(event.providerTransactionId, "trx-9");
  assert.equal(event.paidAmount, "99000.00");
  assert.equal(event.paidCurrency, "IDR");
  assert.equal(event.outcome, "paid");
  // The provider's own wording is kept for audit, separate from the outcome.
  assert.equal(event.providerStatus, "settlement");
  assert.equal(event.raw.order_id, "ORDER-1");
});

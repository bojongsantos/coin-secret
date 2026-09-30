import test from "node:test";
import assert from "node:assert/strict";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";

test("requests are allowed up to the limit, then refused with a retry hint", () => {
  const clock = 0;
  const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000, now: () => clock });

  assert.deepEqual(limiter.check("ip-a"), { allowed: true, remaining: 2, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.check("ip-a"), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.check("ip-a"), { allowed: true, remaining: 0, retryAfterSeconds: 0 });

  const refused = limiter.check("ip-a");
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.equal(refused.retryAfterSeconds, 60);
});

test("each client gets its own budget", () => {
  const clock = 0;
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, now: () => clock });

  assert.equal(limiter.check("ip-a").allowed, true);
  assert.equal(limiter.check("ip-a").allowed, false);
  // One noisy client must not lock everyone else out.
  assert.equal(limiter.check("ip-b").allowed, true);
});

test("the budget refills once the window has passed", () => {
  let clock = 0;
  const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1_000, now: () => clock });

  limiter.check("ip-a");
  limiter.check("ip-a");
  assert.equal(limiter.check("ip-a").allowed, false);

  clock = 1_001;
  assert.equal(limiter.check("ip-a").allowed, true);
});

test("new keys cannot reset existing budgets when capacity is full", () => {
  let clock = 0;
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, maxKeys: 2, now: () => clock });
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("b").allowed, true);
  assert.deepEqual(limiter.check("c"), { allowed: false, remaining: 0, retryAfterSeconds: 1 });
  assert.equal(limiter.check("a").allowed, false);
  clock = 1_000;
  assert.equal(limiter.check("c").allowed, true);
});

test("the key map cannot grow without bound", () => {
  let clock = 0;
  const limiter = createFixedWindowLimiter({
    limit: 1,
    windowMs: 1_000,
    maxKeys: 5,
    now: () => clock,
  });

  // Expired windows are reclaimed rather than accumulating one entry per
  // attacker-chosen key.
  for (let i = 0; i < 50; i++) {
    clock += 2_000;
    assert.equal(limiter.check(`ip-${i}`).allowed, true);
  }

  // A long-standing client still gets a correct decision afterwards.
  assert.equal(limiter.check("ip-final").allowed, true);
  assert.equal(limiter.check("ip-final").allowed, false);
});

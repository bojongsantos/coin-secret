import test from "node:test";
import assert from "node:assert/strict";
import { sessionDeadline, sessionLimits } from "@/core/domain/identity/session-policy";

const minute = 60_000;
const hour = 60 * minute;
const start = Date.UTC(2026, 9, 8, 0);

test("session policy uses the agreed user and administrator limits", () => {
  assert.deepEqual(sessionLimits("USER"), { idleMs: 30 * minute, absoluteMs: 24 * hour });
  assert.deepEqual(sessionLimits("ADMIN"), { idleMs: 15 * minute, absoluteMs: 8 * hour });
});

test("idle activity cannot postpone the absolute session deadline", () => {
  for (const role of ["USER", "ADMIN"]) {
    const { absoluteMs, idleMs } = sessionLimits(role);
    const session = { createdAt: new Date(start), updatedAt: new Date(start), expiresAt: new Date(start + 7 * 24 * hour) };
    assert.equal(sessionDeadline(session, role), start + idleMs);
    session.updatedAt = new Date(start + absoluteMs - minute);
    assert.equal(sessionDeadline(session, role), start + absoluteMs);
    session.updatedAt = new Date(start + absoluteMs + hour);
    assert.equal(sessionDeadline(session, role), start + absoluteMs);
  }
});

test("the provider expiry can only shorten the application session deadline", () => {
  const session = { createdAt: new Date(start), updatedAt: new Date(start), expiresAt: new Date(start + minute) };
  assert.equal(sessionDeadline(session, "USER"), start + minute);
  assert.equal(sessionDeadline(session, "ADMIN"), start + minute);
});

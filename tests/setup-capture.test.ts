import test from "node:test";
import assert from "node:assert/strict";
import { setupSignature } from "@/core/domain/analysis/setup-signature";
import {
  canComposeResult,
  FILLED_STATUSES,
  isFilledStatus,
  isTerminalStatus,
} from "@/core/domain/promo/capture-trigger";

test("a setup keeps one identity while its plan is replanned", () => {
  // The bug this pins, and it is the reason the archive stayed empty: the
  // protective stop is placed beyond the latest confirmed swing, so it moves
  // as bars arrive. Hashing the levels minted a new identity nearly every
  // sweep — one symbol held eleven rows for one setup — and a row that has
  // never been seen before has no previous status to have changed from.
  const zone = { symbol: "ALLOUSDT", timeframe: "15m" as const, direction: "long" as const, zoneBaseTime: 1_787_700_000 };
  const monday = setupSignature(zone);
  const laterThatHour = setupSignature({ ...zone });
  assert.equal(monday, laterThatHour);

  // A different zone is a different setup, even on the same pair and side.
  assert.notEqual(monday, setupSignature({ ...zone, zoneBaseTime: 1_787_700_900 }));
  assert.notEqual(monday, setupSignature({ ...zone, direction: "short" }));
  assert.notEqual(monday, setupSignature({ ...zone, symbol: "ENAUSDT" }));
  assert.notEqual(monday, setupSignature({ ...zone, timeframe: "1H" }));
});

test("a finished setup is recognised as finished", () => {
  // The sweep stops re-checking a setup once this is true, so a status that
  // failed to register here would be looked up forever.
  assert.equal(isTerminalStatus("Target 2 reached"), true);
  assert.equal(isTerminalStatus("Invalidated (SL hit)"), true);
  assert.equal(isTerminalStatus("Missed"), true);
  assert.equal(isTerminalStatus("Target 1 reached"), false, "the first target is a partial");
  assert.equal(isTerminalStatus("Running"), false);
});

test("a proof needs both halves", () => {
  assert.equal(canComposeResult(true, true), true);
  assert.equal(canComposeResult(true, false), false);
  assert.equal(canComposeResult(false, true), false);
});

test("only a filled status can owe an entry photograph", () => {
  // The sweep queries the database with this very list, so a status missing
  // from it is a setup the archive silently never photographs.
  for (const status of ["Filled", "Running", "Target 1 reached", "Target 2 reached"] as const) {
    assert.ok(FILLED_STATUSES.includes(status), `${status} must count as filled`);
    assert.equal(isFilledStatus(status), true);
  }
  for (const status of ["Limit Order", "Missed"] as const) {
    assert.equal(isFilledStatus(status), false, `${status} must not count as filled`);
  }
  // A stop-out means it filled and then lost; the archive keeps only winners,
  // so it is deliberately absent.
  assert.equal(isFilledStatus("Invalidated (SL hit)"), false);
});

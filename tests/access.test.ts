import test from "node:test";
import assert from "node:assert/strict";
import { hasFeature } from "@/core/domain/access/gating";

test("Free and Premium entitlements remain separated", () => {
  assert.equal(hasFeature("free", "scannerExtended"), false);
  assert.equal(hasFeature("free", "signals"), false);
  assert.equal(hasFeature("premium", "scannerExtended"), true);
  assert.equal(hasFeature("premium", "signals"), true);
  assert.equal(hasFeature("free", "signals", true), true);
  assert.equal(hasFeature("premium", "signals", false), false);
});

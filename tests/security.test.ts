import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_REDIRECT, safeRedirectPath } from "@/shared/lib/safe-redirect";

test("post-login redirect keeps the user on this site", () => {
  assert.equal(safeRedirectPath("/history"), "/history");
  assert.equal(safeRedirectPath("/alerts?tab=active"), "/alerts?tab=active");
  assert.equal(safeRedirectPath(null), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath(""), DEFAULT_REDIRECT);
});

test("protocol-relative and backslash destinations are rejected", () => {
  // The classic bypass: starts with "/" yet lands on another origin.
  assert.equal(safeRedirectPath("//evil.com"), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath("///evil.com"), DEFAULT_REDIRECT);
  // Browsers normalise backslashes to slashes before parsing.
  assert.equal(safeRedirectPath("/\\evil.com"), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath("\\\\evil.com"), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath("/\\/evil.com"), DEFAULT_REDIRECT);
});

test("absolute URLs and non-http schemes are rejected", () => {
  assert.equal(safeRedirectPath("https://evil.com"), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath("http://evil.com"), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath("javascript:alert(1)"), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath("data:text/html,<script>"), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath("evil.com"), DEFAULT_REDIRECT);
});

test("encoded and control-character payloads cannot smuggle an origin", () => {
  // "%2F%2Fevil.com" decodes to "//evil.com".
  assert.equal(safeRedirectPath("%2F%2Fevil.com"), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath("%2f%5cevil.com"), DEFAULT_REDIRECT);
  // A stripped tab would turn this into "//evil.com" inside the browser.
  assert.equal(safeRedirectPath("/\t/evil.com"), DEFAULT_REDIRECT);
  assert.equal(safeRedirectPath("/\n/evil.com"), DEFAULT_REDIRECT);
  // Malformed encoding must fail closed rather than throw.
  assert.equal(safeRedirectPath("%E0%A4%A"), DEFAULT_REDIRECT);
});

test("demo seed refuses production and has no password fallback", () => {
  const source = readFileSync(join(process.cwd(), "prisma", "seed.ts"), "utf8");
  assert.match(source, /NODE_ENV === "production"/);
  assert.doesNotMatch(source, /SEED_(?:USER|ADMIN)_PASSWORD\s*\?\?/);
});

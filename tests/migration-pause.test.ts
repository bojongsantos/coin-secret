import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("migration pause blocks requests and webhooks while permitting only read-only health", () => {
  const env: Record<string, string> = {};
  const exports: { proxy?: (request: unknown) => Response | undefined } = {};
  runInNewContext(ts.transpileModule(readFileSync("src/proxy.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, Response, process: { env } });
  const request = (pathname: string, method = "GET") => ({ nextUrl: { pathname }, method });
  assert.equal(exports.proxy?.(request("/dashboard")), undefined);
  env.COINSECRET_MIGRATION_PAUSED = "1";
  assert.equal(exports.proxy?.(request("/api/health")), undefined);
  for (const item of [request("/dashboard"), request("/api/health", "POST"), request("/api/auth/sign-in/email", "POST"), request("/api/billing/webhook/nowpayments", "POST")]) {
    const response = exports.proxy?.(item);
    assert.equal(response?.status, 503);
    assert.equal(response?.headers.get("Cache-Control"), "no-store");
    assert.equal(response?.headers.get("Retry-After"), "60");
  }
});

test("native capture checks migration pause before starting any database work", () => {
  const source = readFileSync("src/infrastructure/monitoring/setup-capture-service.ts", "utf8");
  const start = source.indexOf("export async function runSetupCapture");
  assert.ok(source.indexOf("COINSECRET_MIGRATION_PAUSED", start) < source.indexOf("refreshPublishedBoard({", start));
});

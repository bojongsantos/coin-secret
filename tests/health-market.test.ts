import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function healthWithDerivatives(
  available: boolean,
  mode: "normal" | "partial" | "error" = "normal",
  userRole?: string,
  dbReachable = true,
  publicationStatus: "fresh" | "overdue" = "fresh",
  authFails = false,
) {
  let databaseQueries = 0;
  let publicationReads = 0;
  let authReads = 0;
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  const code = ts.transpileModule(readFileSync("src/app/api/health/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports, Response, Date, Error, performance, AbortSignal,
    fetch: async () => new Response("{}"),
    require: (name: string) => {
      if (name.endsWith("/readiness")) return { assessReadiness: () => [] };
      if (name.endsWith("/gateway-factory")) return { selectedPaymentProvider: () => "nowpayments" };
      if (name.endsWith("/current-user")) return { getCurrentUser: async () => {
        authReads++;
        if (authFails) throw new Error("Sensitive database details during admin lookup");
        return userRole ? { role: userRole } : null;
      } };
      if (name.endsWith("/signals-publication")) return { readSignalsPublication: async () => {
        publicationReads++;
        return { status: publicationStatus, verified: publicationStatus === "fresh", scannedAt: "2026-10-12T00:00:00.000Z", ageSeconds: 0 };
      } };
      if (name.endsWith("/database/health")) return { readDatabaseHealth: async () => {
        databaseQueries++;
        return { status: dbReachable ? "ok" : "down", latencyMs: 1, checkedAt: "2026-10-26T14:00:00.000Z" };
      } };
      if (name.endsWith("/market-context-service")) return {
        getDerivativesDiagnostics: () => ({ checkedAt: "2026-10-05T00:00:00.000Z", source: available ? "bybit" : null, providers: [
          { provider: "binance", status: "down", detail: "HTTP 451" },
          { provider: "bybit", status: available ? "ok" : "down", detail: available ? "available" : "timeout" },
        ] }),
        getMarketContextPayload: async () => {
          if (mode === "error") throw new Error("offline");
          return { context: {
            fundingRate: { value: available ? "0.01%" : "—", warning: !available },
            openInterest: { value: available && mode !== "partial" ? "$1B" : "—", warning: !available || mode === "partial" },
          } };
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
    process: { env: {} },
  });
  const response = await exports.GET(new Request("https://coinsecret.io/api/health", {
    headers: userRole ? { cookie: "coinsecret.session_token=test" } : {},
  }));
  const payload = await response.json();
  return {
    results: payload.results as Array<{ id: string; status: string; detail: string }>,
    configuration: payload.configuration,
    status: response.status,
    databaseQueries,
    publicationReads,
    authReads,
  };
}

test("public health reports a sanitized database outage without session or privileged reads", async () => {
  const { results, databaseQueries, publicationReads, authReads, configuration, status } = await healthWithDerivatives(true, "normal", undefined, false);
  assert.equal(results.find((r) => r.id === "database-live")?.status, "down");
  assert.equal(databaseQueries, 1);
  assert.equal(authReads, 0);
  assert.equal(configuration, undefined);
  assert.equal(status, 503);
  assert.equal(publicationReads, 0);
  assert.equal(results.some((r) => r.id === "signals-publication"), false);
  assert.doesNotMatch(JSON.stringify(results), /sensitive|DATABASE_URL|prisma|postgresql/i);
});

test("health survives failing admin authentication and never exposes configuration to an unverified role", async () => {
  const { results, configuration, status, authReads, publicationReads } = await healthWithDerivatives(true, "normal", "ADMIN", true, "fresh", true);
  assert.equal(status, 503);
  assert.equal(authReads, 1);
  assert.equal(publicationReads, 0);
  assert.equal(configuration, undefined);
  assert.equal(results.find((r) => r.id === "authentication")?.status, "down");
  assert.doesNotMatch(JSON.stringify(results), /sensitive/i);
});

test("Signals publication diagnostics are admin-only and report overdue durable data", async () => {
  const ordinary = await healthWithDerivatives(true, "normal", "USER");
  assert.equal(ordinary.publicationReads, 0);
  assert.equal(ordinary.results.some((r) => r.id === "signals-publication"), false);
  const admin = await healthWithDerivatives(true, "normal", "ADMIN", true, "overdue");
  assert.equal(admin.publicationReads, 1);
  const result = admin.results.find((r) => r.id === "signals-publication");
  assert.equal(result?.status, "down");
  assert.match(result?.detail ?? "", /overdue.*Last scan/);
});

test("admins receive database live health status without raw connection strings leaking", async () => {
  const { results: okResults, databaseQueries: okQueries } = await healthWithDerivatives(true, "normal", "ADMIN", true);
  const dbOk = okResults.find((r) => r.id === "database-live");
  assert.equal(dbOk?.status, "ok");
  assert.equal(okQueries, 1);

  const { results: downResults, databaseQueries: downQueries } = await healthWithDerivatives(true, "normal", "ADMIN", false);
  const dbDown = downResults.find((r) => r.id === "database-live");
  assert.equal(dbDown?.status, "down");
  assert.equal(downQueries, 1);
  assert.doesNotMatch(dbDown?.detail ?? "", /sensitive connection detail/);
});

test("futures health reflects derivative figures served by product, including fallback venues", async () => {
  const { results } = await healthWithDerivatives(true);
  const result = results.find((item) => item.id === "binance-futures");
  assert.equal(result?.status, "ok");
  assert.match(result?.detail ?? "", /market context/i);
  assert.doesNotMatch(result?.detail ?? "", /HTTP 451|binance:/, "provider diagnostics stay admin-only");
});

test("admin futures health identifies safe provider failures and the observation time", async () => {
  const { results } = await healthWithDerivatives(false, "normal", "ADMIN");
  const detail = results.find((item) => item.id === "binance-futures")?.detail ?? "";
  assert.match(detail, /binance: HTTP 451/);
  assert.match(detail, /bybit: timeout/);
  assert.match(detail, /Checked 2026-10-05/);
});

test("futures health is down when product cannot obtain either derivative figure", async () => {
  const { results } = await healthWithDerivatives(false);
  const result = results.find((item) => item.id === "binance-futures");
  assert.equal(result?.status, "down");
});

test("futures health is down when one derivative metric is missing or when the market service throws", async () => {
  const { results: partialResults } = await healthWithDerivatives(true, "partial");
  const partial = partialResults.find((item) => item.id === "binance-futures");
  assert.equal(partial?.status, "down");

  const { results: thrownResults } = await healthWithDerivatives(false, "error");
  const thrown = thrownResults.find((item) => item.id === "binance-futures");
  assert.equal(thrown?.status, "down");
});

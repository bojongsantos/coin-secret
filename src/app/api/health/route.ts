import { assessReadiness, type CapabilityReport } from "@/core/domain/ops/readiness";
import { selectedPaymentProvider } from "@/infrastructure/billing/gateway-factory";
import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { getDerivativesDiagnostics, getMarketContextPayload } from "@/infrastructure/market-data/market-context-service";
import { readDatabaseHealth } from "@/infrastructure/database/health";
import { readSignalsPublication } from "@/infrastructure/monitoring/signals-publication";

/** Names of the variables that currently hold a non-empty value. */
function configuredKeys(): string[] {
  return Object.entries(process.env)
    .filter(([, value]) => typeof value === "string" && value.trim() !== "")
    .map(([key]) => key);
}

interface HealthResult {
  id: string;
  name: string;
  endpoint: string;
  status: "ok" | "down";
  latencyMs: number;
  detail: string;
}

async function check(
  id: string,
  name: string,
  endpoint: string,
  urls: string[],
): Promise<HealthResult> {
  const start = performance.now();
  try {
    const responses = await Promise.all(
      urls.map((url) =>
        fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
          headers: { Accept: "application/json" },
        }),
      ),
    );
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`HTTP ${failed.status}`);
    const latencyMs = Math.round(performance.now() - start);
    return { id, name, endpoint, status: "ok", latencyMs, detail: `Online · ${latencyMs}ms` };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      id,
      name,
      endpoint,
      status: "down",
      latencyMs,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkDerivatives(includeDiagnostics: boolean): Promise<HealthResult> {
  const start = performance.now();
  try {
    const { context } = await getMarketContextPayload();
    const available = !context.fundingRate.warning && !context.openInterest.warning;
    const latencyMs = Math.round(performance.now() - start);
    const diagnostic = includeDiagnostics ? getDerivativesDiagnostics() : null;
    const providerDetail = diagnostic
      ? ` · Checked ${diagnostic.checkedAt} · ${diagnostic.providers.map((item) => `${item.provider}: ${item.detail}`).join("; ")}`
      : "";
    return {
      id: "binance-futures", name: "Futures Market Data", endpoint: "market context",
      status: available ? "ok" : "down", latencyMs,
      detail: (available ? `Market context available · ${latencyMs}ms` : "Funding rate or open interest unavailable") + providerDetail,
    };
  } catch {
    return {
      id: "binance-futures", name: "Futures Market Data", endpoint: "market context",
      status: "down", latencyMs: Math.round(performance.now() - start),
      detail: "Market context unavailable",
    };
  }
}

export async function GET(request: Request) {
  // Which keys are absent tells an attacker which flows are unguarded or
  // unavailable, so the configuration report is for admins only. The external
  // service checks reveal nothing private and stay public.
  const database = await readDatabaseHealth();
  let authUnavailable = false;
  // Public health probes do not need session/rate-limit database work. When the
  // database is down, admin detection cannot succeed and must not hide health.
  const user = database.status === "ok" && request.headers.get("cookie")?.includes("coinsecret")
    ? await getCurrentUser().catch(() => { authUnavailable = true; return null; }) : null;
  const isAdmin = user?.role === "ADMIN";
  const configuration: CapabilityReport[] | undefined =
    isAdmin ? assessReadiness(configuredKeys(), selectedPaymentProvider()) : undefined;

  const dbResult: HealthResult = {
    id: "database-live", name: "Application Database", endpoint: "application database",
    status: database.status, latencyMs: database.latencyMs,
    detail: database.status === "ok" ? "Available" : "Temporarily unavailable",
  };
  let signalsResult: HealthResult | null = null;
  if (isAdmin) {
    const signalsStart = performance.now();
    const publication = await readSignalsPublication();
    signalsResult = {
      id: "signals-publication", name: "Signals Publication", endpoint: "durable board readback",
      status: publication.verified ? "ok" : "down", latencyMs: Math.round(performance.now() - signalsStart),
      detail: publication.scannedAt === null ? `Durable board ${publication.status}`
        : `${publication.status} · Last scan ${publication.scannedAt} · Age ${publication.ageSeconds}s · Overdue after 45m`,
    };
  }

  const results = await Promise.all([
    check("binance-spot", "Binance Spot", "data-api.binance.vision", [
      "https://data-api.binance.vision/api/v3/ping",
    ]),
    checkDerivatives(isAdmin),
    check("coingecko", "CoinGecko", "api.coingecko.com", [
      "https://api.coingecko.com/api/v3/global",
    ]),
    check("fear-greed", "Fear & Greed", "api.alternative.me", [
      "https://api.alternative.me/fng/",
    ]),
  ]);

  results.unshift(dbResult);
  if (authUnavailable) results.unshift({
    id: "authentication", name: "Account Access", endpoint: "application authentication",
    status: "down", latencyMs: 0, detail: "Temporarily unavailable",
  });
  if (signalsResult) results.unshift(signalsResult);

  const healthy = results.every((result) => result.status === "ok");
  return Response.json(
    { results, configuration, checkedAt: new Date().toISOString(), databaseCheckedAt: database.checkedAt },
    { status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store", ...(!healthy ? { "Retry-After": "30" } : {}) } },
  );
}

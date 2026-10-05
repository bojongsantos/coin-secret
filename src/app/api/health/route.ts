import { assessReadiness, type CapabilityReport } from "@/core/domain/ops/readiness";
import { selectedPaymentProvider } from "@/infrastructure/billing/gateway-factory";
import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { getDerivativesDiagnostics, getMarketContextPayload } from "@/infrastructure/market-data/market-context-service";
import { prisma } from "@/infrastructure/database/prisma";

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

export async function GET() {
  // Which keys are absent tells an attacker which flows are unguarded or
  // unavailable, so the configuration report is for admins only. The external
  // service checks reveal nothing private and stay public.
  const user = await getCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const configuration: CapabilityReport[] | undefined =
    isAdmin ? assessReadiness(configuredKeys(), selectedPaymentProvider()) : undefined;

  let dbResult: HealthResult | null = null;
  if (isAdmin) {
    const dbStart = performance.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const latencyMs = Math.round(performance.now() - dbStart);
      dbResult = {
        id: "database-live",
        name: "PostgreSQL Database",
        endpoint: "prisma $queryRaw",
        status: "ok",
        latencyMs,
        detail: `Connected · ${latencyMs}ms`,
      };
    } catch {
      const latencyMs = Math.round(performance.now() - dbStart);
      dbResult = {
        id: "database-live",
        name: "PostgreSQL Database",
        endpoint: "prisma $queryRaw",
        status: "down",
        latencyMs,
        detail: "Database connection failed",
      };
    }
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

  if (dbResult) {
    results.unshift(dbResult);
  }

  return Response.json(
    { results, configuration, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

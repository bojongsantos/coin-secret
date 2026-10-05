import "server-only";

import type { MarketContextPayload } from "@/core/domain/models";
import {
  formatFundingRate,
  formatOpenInterest,
  parseBinanceDerivatives,
  parseBybitDerivatives,
  parseOkxDerivatives,
  type BybitTickerResponse,
  type DerivativesSnapshot,
  type OkxFundingResponse,
  type OkxOpenInterestResponse,
} from "@/core/domain/market/derivatives";
import { formatCompact } from "@/shared/lib/format";
import { marketData } from "@/infrastructure/market-data/market-data-provider";

const MARKET_TTL_MS = 30_000;
const EXTERNAL_TIMEOUT_MS = 8_000;
const DERIVATIVES_BUDGET_MS = 8_000;
const DERIVATIVES_PROVIDER_MS = 2_500;

let cached: { timestamp: number; payload: MarketContextPayload } | null = null;
let inFlight: Promise<MarketContextPayload> | null = null;

interface DerivativesDiagnostic {
  checkedAt: string;
  source: string | null;
  providers: Array<{ provider: string; status: "ok" | "down"; detail: string }>;
}

let derivativesDiagnostic: DerivativesDiagnostic | null = null;

/** Safe provider outcomes for the authenticated operations report. */
export function getDerivativesDiagnostics(): DerivativesDiagnostic | null {
  return derivativesDiagnostic;
}

class ExternalHttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); }
}

const SAFE_FAILURE_CODES = new Set([
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

function failureCode(error: unknown): string {
  if (error instanceof ExternalHttpError) return "HTTP_ERROR";
  const failure = error as { code?: unknown; cause?: { code?: unknown }; name?: unknown } | null;
  const code = failure?.cause?.code ?? failure?.code;
  if (typeof code === "string" && SAFE_FAILURE_CODES.has(code)) return code;
  return failure?.name === "SyntaxError" ? "JSON_PARSE_ERROR" : "UNKNOWN";
}

async function externalJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(EXTERNAL_TIMEOUT_MS);
  const res = await fetch(url, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new ExternalHttpError(res.status);
  return (await res.json()) as T;
}

function optionalFinite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function fearGreedLabel(value: number): string {
  if (value <= 20) return "Extreme Fear";
  if (value <= 40) return "Fear";
  if (value < 60) return "Neutral";
  if (value < 80) return "Greed";
  return "Extreme Greed";
}

/**
 * Funding rate and open interest, from whichever futures venue answers.
 *
 * Binance is tried first. Some regions or providers may be unavailable,
 * so Bybit and OKX are asked in turn.
 *
 * Sources are tried in sequence, not in parallel: on the normal path the first
 * one answers and the other two are never called at all. Each venue has a
 * short deadline within one shared budget, rather than three full waits.
 */
async function fetchDerivatives(btcPrice: number): Promise<DerivativesSnapshot | null> {
  const attempts: Array<{ provider: string; load: (signal: AbortSignal) => Promise<DerivativesSnapshot | null> }> = [
    { provider: "binance", load: async (signal) => {
      const [premium, oi] = await Promise.all([
        externalJson<{ lastFundingRate?: string }>(
          "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
          signal,
        ),
        externalJson<{ openInterest?: string }>(
          "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT",
          signal,
        ),
      ]);
      return parseBinanceDerivatives(premium, oi, btcPrice);
    } },
    { provider: "bybit", load: async (signal) =>
      parseBybitDerivatives(
        await externalJson<BybitTickerResponse>(
          "https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT",
          signal,
        ),
      ) },
    { provider: "okx", load: async (signal) => {
      const [funding, oi] = await Promise.all([
        externalJson<OkxFundingResponse>(
          "https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP",
          signal,
        ),
        externalJson<OkxOpenInterestResponse>(
          "https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP",
          signal,
        ),
      ]);
      return parseOkxDerivatives(funding, oi, btcPrice);
    } },
  ];

  const budget = AbortSignal.timeout(DERIVATIVES_BUDGET_MS);
  const diagnostic: DerivativesDiagnostic = { checkedAt: new Date().toISOString(), source: null, providers: [] };
  for (const { provider, load } of attempts) {
    if (budget.aborted) break;
    const started = performance.now();
    const controller = new AbortController();
    const signal = AbortSignal.any([budget, AbortSignal.timeout(DERIVATIVES_PROVIDER_MS), controller.signal]);
    try {
      const result = await load(signal);
      signal.throwIfAborted();
      diagnostic.providers.push({ provider, status: result ? "ok" : "down", detail: result ? "available" : "invalid response" });
      if (result) {
        diagnostic.source = result.source;
        derivativesDiagnostic = diagnostic;
        return result;
      }
    } catch (error) {
      console.warn("[market.derivatives.failure]", {
        provider,
        elapsedMs: Math.round(performance.now() - started),
        code: signal.aborted ? "TIMEOUT" : failureCode(error),
      });
      const detail = signal.aborted ? "timeout" : error instanceof ExternalHttpError ? `HTTP ${error.status}` : "network or response failure";
      diagnostic.providers.push({ provider, status: "down", detail });
    } finally {
      // Cancel a sibling request when one half of a venue's response fails.
      controller.abort();
    }
  }
  derivativesDiagnostic = diagnostic;
  return null;
}

async function buildPayload(): Promise<MarketContextPayload> {
  const [btcResult, ethResult, dominanceResult, fearGreedResult] =
    await Promise.allSettled([
      marketData.fetchTicker24h("BTCUSDT"),
      marketData.fetchTicker24h("ETHUSDT"),
      externalJson<{
        data?: {
          market_cap_percentage?: { btc?: number };
          market_cap_change_percentage_24h_usd?: number;
        };
      }>("https://api.coingecko.com/api/v3/global"),
      externalJson<{ data?: Array<{ value?: string }> }>("https://api.alternative.me/fng/"),
    ]);

  if (btcResult.status !== "fulfilled" || ethResult.status !== "fulfilled") {
    throw new Error("Core exchange ticker data is unavailable");
  }

  const btc = btcResult.value;
  const eth = ethResult.value;
  // Needs the spot price, so it runs after the tickers rather than beside them.
  const derivatives = await fetchDerivatives(btc.lastPrice);
  const dominance =
    dominanceResult.status === "fulfilled"
      ? dominanceResult.value.data?.market_cap_percentage?.btc
      : undefined;
  const dominanceChange =
    dominanceResult.status === "fulfilled"
      ? dominanceResult.value.data?.market_cap_change_percentage_24h_usd
      : undefined;
  const fearGreedValue =
    fearGreedResult.status === "fulfilled"
      ? optionalFinite(fearGreedResult.value.data?.[0]?.value)
      : null;
  const fearGreed = fearGreedValue ?? 50;
  const fearGreedAvailable = fearGreedValue !== null;
  const sentimentLabel = fearGreedLabel(fearGreed);

  return {
    fetchedAt: new Date().toISOString(),
    context: {
      btc: {
        id: "btc",
        label: "BTC",
        value: formatCompact(btc.lastPrice),
        change: btc.priceChangePercent,
        direction: btc.priceChangePercent >= 0 ? "up" : "down",
      },
      eth: {
        id: "eth",
        label: "ETH",
        value: formatCompact(eth.lastPrice),
        change: eth.priceChangePercent,
        direction: eth.priceChangePercent >= 0 ? "up" : "down",
      },
      dominance: {
        id: "dom",
        label: "BTC Dominance",
        value: typeof dominance === "number" ? `${dominance.toFixed(2)}%` : "—",
        change: dominanceChange ?? 0,
        direction: !dominanceChange ? "flat" : dominanceChange > 0 ? "up" : "down",
        hint: "24h change",
        warning: typeof dominance !== "number",
      },
      fundingRate: {
        id: "funding",
        label: "Funding Rate",
        value: derivatives === null ? "—" : formatFundingRate(derivatives.fundingRate),
        change: derivatives === null ? 0 : derivatives.fundingRate * 100,
        direction:
          derivatives === null || derivatives.fundingRate === 0
            ? "flat"
            : derivatives.fundingRate > 0
              ? "up"
              : "down",
        hint: derivatives ? `BTC perp · ${derivatives.source}` : "BTC perp",
        tone:
          derivatives === null ? undefined : derivatives.fundingRate >= 0 ? "positive" : "negative",
        warning: derivatives === null,
        hideDelta: true,
      },
      openInterest: {
        id: "oi",
        label: "Open Interest",
        value: derivatives === null ? "—" : formatOpenInterest(derivatives.openInterestUsd),
        change: 0,
        direction: "flat",
        hint: derivatives ? `BTC futures · ${derivatives.source}` : "BTC futures",
        warning: derivatives === null,
        hideDelta: true,
      },
      volume: {
        id: "fng",
        label: "Fear & Greed",
        value: fearGreedAvailable ? `${sentimentLabel} · ${fearGreed}/100` : "—",
        change: 0,
        direction: "flat",
        tone:
          sentimentLabel.includes("Fear")
            ? "negative"
            : sentimentLabel.includes("Greed")
              ? "positive"
              : undefined,
        warning: !fearGreedAvailable,
        hideDelta: true,
      },
    },
    sentiment: {
      score: fearGreed,
      label: sentimentLabel,
      available: fearGreedAvailable,
      // This is an index scale, not an invented market distribution.
      distribution: [
        { label: "Extreme Fear", value: 20 },
        { label: "Fear", value: 20 },
        { label: "Neutral", value: 20 },
        { label: "Greed", value: 20 },
        { label: "Extreme Greed", value: 20 },
      ],
    },
  };
}

export function getMarketContextPayload(force = false): Promise<MarketContextPayload> {
  if (!force && cached && Date.now() - cached.timestamp < MARKET_TTL_MS) {
    return Promise.resolve(cached.payload);
  }
  if (inFlight) return inFlight;
  inFlight = buildPayload()
    .then((payload) => {
      cached = { timestamp: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

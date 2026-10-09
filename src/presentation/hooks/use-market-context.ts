"use client";

import type { MarketContextPayload } from "@/core/domain/models";
import { usePollingRead } from "@/presentation/hooks/use-polling-read";
import { ReadFailure, responseReadFailure } from "@/shared/lib/read-failure";

const MARKET_REQUEST_MS = 45_000;

async function readMarketContext(_force: boolean, signal: AbortSignal): Promise<MarketContextPayload> {
  const response = await fetch("/api/market-context", {
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(MARKET_REQUEST_MS)]),
  });
  if (!response.ok) throw responseReadFailure(response.status, "Market data", response.headers.get("retry-after"));
  const payload = await response.json();
  if (!payload?.context || typeof payload.context !== "object" || Array.isArray(payload.context) ||
      !payload.sentiment || typeof payload.sentiment !== "object" || Array.isArray(payload.sentiment) ||
      typeof payload.fetchedAt !== "string" || !Number.isFinite(Date.parse(payload.fetchedAt))) {
    throw new ReadFailure("Market data returned an unreadable response. Please refresh.");
  }
  return payload as MarketContextPayload;
}

const marketUpdatedAt = (data: MarketContextPayload) => data.fetchedAt;

export function useMarketContext(enabled = true) {
  const { data, loading, error, lastUpdated, stale, refresh } = usePollingRead({
    enabled, label: "Market data", refreshMs: 30_000, retainOnError: true,
    read: readMarketContext, updatedAt: marketUpdatedAt,
  });
  return { context: data?.context ?? null, sentiment: data?.sentiment ?? null, loading, error, lastUpdated, stale, refresh };
}

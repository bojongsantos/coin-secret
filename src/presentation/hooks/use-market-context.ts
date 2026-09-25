"use client";

import { useEffect, useState } from "react";
import type { MarketContext, MarketContextPayload, SentimentData } from "@/core/domain/models";

export function useMarketContext(enabled = true): {
  context: MarketContext | null;
  sentiment: SentimentData | null;
  loading: boolean;
} {
  const [context, setContext] = useState<MarketContext | null>(null);
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function load() {
      controller = new AbortController();
      try {
        const response = await fetch("/api/market-context", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Market context HTTP ${response.status}`);
        const payload = (await response.json()) as MarketContextPayload;
        if (cancelled) return;
        setContext(payload.context);
        setSentiment(payload.sentiment);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error("[market-context] local API failed:", error);
        setContext(null);
        setSentiment(null);
      } finally {
        if (!cancelled) setLoading(false);
        if (!cancelled) timer = setTimeout(load, 30_000);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return { context, sentiment, loading };
}

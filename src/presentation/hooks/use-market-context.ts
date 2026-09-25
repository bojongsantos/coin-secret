"use client";

import { useEffect, useState } from "react";
import type { MarketContext, MarketContextPayload, SentimentData } from "@/core/domain/models";

export function useMarketContext(enabled = true, initial: MarketContextPayload | null = null): {
  context: MarketContext | null;
  sentiment: SentimentData | null;
} {
  const [context, setContext] = useState<MarketContext | null>(initial?.context ?? null);
  const [sentiment, setSentiment] = useState<SentimentData | null>(initial?.sentiment ?? null);

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
        if (!cancelled) timer = setTimeout(load, 30_000);
      }
    }

    if (!initial) void load();
    else timer = setTimeout(load, 30_000);
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, initial]);

  return { context, sentiment };
}

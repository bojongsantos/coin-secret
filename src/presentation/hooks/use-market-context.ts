"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketContext, MarketContextPayload, SentimentData } from "@/core/domain/models";

const MARKET_REQUEST_MS = 45_000;

export function useMarketContext(enabled = true): {
  context: MarketContext | null;
  sentiment: SentimentData | null;
  loading: boolean;
  refresh: () => void;
} {
  const [context, setContext] = useState<MarketContext | null>(null);
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!enabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch("/api/market-context", {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(MARKET_REQUEST_MS)]),
      });
      if (!response.ok) throw new Error(`Market context HTTP ${response.status}`);
      const payload = (await response.json()) as MarketContextPayload;
      if (controller.signal.aborted) return;
      setContext(payload.context);
      setSentiment(payload.sentiment);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("[market-context] local API failed:", error);
      setContext(null);
      setSentiment(null);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const kickoff = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
      request.current?.abort();
      request.current = null;
    };
  }, [enabled, load]);

  return { context, sentiment, loading: enabled && loading, refresh: useCallback(() => void load(), [load]) };
}

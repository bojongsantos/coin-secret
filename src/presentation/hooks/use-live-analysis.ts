"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchListingTime,
  loadHistory,
  HISTORY_PAGE_SIZE,
  type HistoryProgress,
} from "@/core/application/market-data/history-loader";
import {
  estimateRangeCandles,
  type HistoryRange,
} from "@/core/application/market-data/history-plan";
import { buildAnalysisResult } from "@/core/domain/analysis/analysis-engine";
import type { PublishedSetup } from "@/core/domain/analysis/supply-demand";
import { applyRecentCandles, olderThan, upsertLatestCandle } from "@/core/domain/market/candles";
import type { AnalysisResult, Candle, MarketTicker, Timeframe } from "@/core/domain/models";
import { marketData } from "@/infrastructure/market-data/market-data-provider";
import {
  subscribeBinanceMarket,
  type BinanceStreamStatus,
} from "@/infrastructure/market-data/binance-stream-client";

export const FALLBACK_POLL_MS = 4_000;

/** Candles fed to the analysis engine. Older bars are for the chart only. */
const ANALYSIS_WINDOW_SIZE = 1_000;

/**
 * How often the chart re-reads the published plan.
 *
 * Matches the signals tables, so the status on the chart and the status in the
 * table change over within the same minute rather than drifting apart.
 */
const PUBLISHED_REFRESH_MS = 60_000;

/**
 * Minimum gap between chart repaints for live price movement.
 *
 * Every repaint re-runs the analysis and redraws the setup zone, so repainting
 * on each websocket tick spent most of a frame budget refreshing a candle that
 * had barely moved. Two and a half updates per second still reads as live.
 */
const LIVE_THROTTLE_MS = 400;

export interface HistoryState {
  loading: boolean;
  progress: HistoryProgress | null;
  /** The candle budget stopped the load short of the requested range. */
  truncated: boolean;
  /** The oldest loaded candle is the first this market ever printed. */
  reachedStart: boolean;
}

export interface LiveAnalysis {
  analysis: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  streamStatus: BinanceStreamStatus;
  history: HistoryState;
  loadMoreHistory: () => Promise<void>;
  /**
   * Interval the published plan for this symbol lives on, once known.
   *
   * A plan can only be drawn on the chart it was measured against: its zone is
   * anchored to a bar that does not exist at another interval. Rather than
   * withhold the plan, the page moves the chart to meet it.
   */
  publishedTimeframe: Timeframe | null;
}

export function useLiveAnalysis(
  symbol: string,
  timeframe: Timeframe,
  range: HistoryRange,
): LiveAnalysis {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<BinanceStreamStatus>("connecting");
  const [history, setHistory] = useState<HistoryState>({
    loading: false,
    progress: null,
    truncated: false,
    reachedStart: false,
  });

  // The plan already published for this chart, fetched alongside the candles.
  // Held in a ref because every live tick re-renders from it and a state
  // update per tick would repaint the chart for no reason.
  const publishedRef = useRef<PublishedSetup | null>(null);
  const [publishedTimeframe, setPublishedTimeframe] = useState<Timeframe | null>(null);
  // Set by the stream effect; lets a freshly fetched plan repaint immediately
  // instead of waiting for the next tick to arrive.
  const repaintRef = useRef<(() => void) | null>(null);

  const loadMoreRef = useRef<() => Promise<void>>(async () => undefined);
  const loadMoreHistory = useCallback(() => loadMoreRef.current(), []);

  // Switching symbol, timeframe or range starts a different chart entirely.
  // Resetting while rendering (React's documented "adjust state when a prop
  // changes" pattern) clears the previous market in the same commit, so the
  // old candles never flash under the new header.
  const viewKey = `${symbol}|${timeframe}|${range}`;
  const [renderedKey, setRenderedKey] = useState(viewKey);
  if (viewKey !== renderedKey) {
    setRenderedKey(viewKey);
    setAnalysis(null);
    setError(null);
    setLoading(true);
    setStreamStatus("connecting");
    setHistory({ loading: true, progress: null, truncated: false, reachedStart: false });
  }

  // The published plan for this chart. Cleared first so a stale one from the
  // previous symbol can never be drawn over the new market, then refreshed on
  // the same cadence as the signals table so a status change lands here too.
  useEffect(() => {
    let cancelled = false;
    publishedRef.current = null;

    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/setup?symbol=${encodeURIComponent(symbol)}`);
        if (!response.ok) return;
        const payload = (await response.json()) as {
          setup?: (PublishedSetup & { timeframe?: Timeframe }) | null;
        };
        if (cancelled) return;
        const setup = payload.setup ?? null;
        setPublishedTimeframe(setup?.timeframe ?? null);
        // Only drawn on its own chart. At another interval the zone's base bar
        // does not exist, and the plan would be pinned to whatever sat at the
        // far left instead.
        publishedRef.current = setup && setup.timeframe === timeframe ? setup : null;
        repaintRef.current?.();
      } catch {
        // The chart detects for itself; a missing plan is not a broken page.
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), PUBLISHED_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    // The series is kept in two pieces so bulk history never forces a re-sort.
    // `older` holds backfilled stretches, ascending and all older than
    // `recent`; `recent` holds the newest window plus every live update. They
    // are joined lazily and the result memoised, so repeated publishes without
    // a change cost nothing.
    const older: Candle[][] = [];
    const pendingOlder: Candle[][] = [];
    let recent: Candle[] = [];
    let composed: Candle[] | null = null;
    let ticker: MarketTicker | null = null;
    let listingSeconds: number | null = null;
    let lastPublishedAt = 0;
    let extending = false;
    let exhausted = false;

    function series(): Candle[] {
      if (composed) return composed;
      composed = older.length === 0 ? recent : [...older.flat(), ...recent];
      return composed;
    }

    function invalidate() {
      composed = null;
    }

    /**
     * Adds a stretch of history in front of everything held so far. Any
     * overlap with what is already loaded is trimmed, because a backfill
     * covers the whole range and its newest pages repeat the visible window.
     *
     * Stretches wait in `pendingOlder` until committed, so a burst of pages
     * does not push the chart's left edge on every single one.
     */
    function prependOlder(batch: Candle[]) {
      if (batch.length === 0) return;
      const trimmed = olderThan(batch, oldestTime() ?? Number.POSITIVE_INFINITY);
      if (trimmed.length === 0) return;
      pendingOlder.unshift(trimmed);
    }

    /**
     * Hands every waiting stretch to the chart in one go.
     *
     * Called when a load finishes rather than as pages arrive. Extending the
     * left edge forces the chart to ingest the whole series again, and that
     * single operation dominates the cost of a lifetime load — roughly two
     * seconds for a hundred thousand bars. Doing it per page repeated that
     * stall continuously while the new bars sat far off-screen, where nobody
     * could see them anyway.
     */
    function commitOlder(): boolean {
      if (pendingOlder.length === 0) return false;
      older.unshift(...pendingOlder);
      pendingOlder.length = 0;
      invalidate();
      return true;
    }

    function oldestTime(): number | null {
      const first = pendingOlder[0]?.[0] ?? older[0]?.[0] ?? recent[0];
      return first?.time ?? null;
    }

    function reachedStart(): boolean {
      const oldest = oldestTime();
      return exhausted || (listingSeconds !== null && oldest !== null && oldest <= listingSeconds);
    }

    function render() {
      if (cancelled || !ticker) return;
      const candles = series();
      if (candles.length === 0) return;
      lastPublishedAt = Date.now();
      const base = symbol.replace(/USDT$/, "") || symbol;
      const result = buildAnalysisResult(
        symbol,
        base,
        "USDT",
        timeframe,
        "Binance",
        candles.slice(-ANALYSIS_WINDOW_SIZE),
        ticker,
        publishedRef.current,
      );
      setAnalysis({ ...result, chartData: { ...result.chartData, candles } });
      setError(null);
    }

    /** Repaints at most once per throttle window, never dropping the last frame. */
    function publish() {
      if (cancelled) return;
      const gap = LIVE_THROTTLE_MS;
      const elapsed = Date.now() - lastPublishedAt;
      if (elapsed >= gap) {
        if (publishTimer) {
          clearTimeout(publishTimer);
          publishTimer = undefined;
        }
        render();
        return;
      }
      if (publishTimer) return;
      publishTimer = setTimeout(() => {
        publishTimer = undefined;
        render();
      }, gap - elapsed);
    }

    function fail(caught: unknown) {
      if (cancelled || controller.signal.aborted) return;
      if (recent.length === 0) {
        setAnalysis(null);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }

    /** Phase one: the newest window, so the chart is usable immediately. */
    async function loadRecent() {
      // Ask for the selected range, not a fixed page, so a short range never
      // arrives padded with history the user did not ask to see.
      const wanted = estimateRangeCandles(range, timeframe);
      const recentLimit = Math.min(HISTORY_PAGE_SIZE, wanted ?? HISTORY_PAGE_SIZE);
      try {
        const [latestTicker, latestCandles] = await Promise.all([
          marketData.fetchTicker24h(symbol, controller.signal),
          marketData.fetchKlines({
            symbol,
            timeframe,
            limit: recentLimit,
            signal: controller.signal,
          }),
        ]);
        if (cancelled) return;
        recent = latestCandles;
        invalidate();
        ticker = latestTicker;
        render();
      } catch (caught) {
        fail(caught);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    /** Phase two: backfill the selected range behind the newest window. */
    async function loadRange() {
      try {
        listingSeconds = await fetchListingTime(marketData, symbol, timeframe, controller.signal);
      } catch {
        listingSeconds = null;
      }
      if (cancelled) return;
      try {
        const loaded = await loadHistory({
          marketData,
          symbol,
          timeframe,
          range,
          nowSeconds: Math.floor(Date.now() / 1_000),
          listingSeconds,
          signal: controller.signal,
          onProgress: (progress) => {
            if (!cancelled) setHistory((prev) => ({ ...prev, progress }));
          },
          onPartial: (batch) => {
            if (cancelled) return;
            // Accumulate only. The chart is left untouched until the load ends.
            prependOlder(batch);
          },
        });
        if (cancelled) return;
        // The stretches already arrived through onPartial; the returned series
        // only matters when no partial handler consumed them.
        if (older.length === 0 && pendingOlder.length === 0) prependOlder(loaded.candles);
        commitOlder();
        setHistory({
          loading: false,
          progress: null,
          truncated: loaded.truncated,
          reachedStart: reachedStart(),
        });
        publish();
      } catch (caught) {
        if (cancelled) return;
        setHistory((prev) => ({ ...prev, loading: false }));
        fail(caught);
      }
    }

    /** Cheap poll that keeps the last bar fresh when the socket is down. */
    async function pollLatest() {
      try {
        const [latestTicker, latest] = await Promise.all([
          marketData.fetchTicker24h(symbol, controller.signal),
          marketData.fetchKlines({ symbol, timeframe, limit: 2, signal: controller.signal }),
        ]);
        if (cancelled) return;
        ticker = latestTicker;
        recent = applyRecentCandles(recent, latest);
        invalidate();
        publish();
      } catch (caught) {
        fail(caught);
      }
    }

    /** Scroll-triggered paging further back than the loaded window. */
    loadMoreRef.current = async () => {
      const oldest = oldestTime();
      if (cancelled || extending || exhausted || oldest === null) return;
      extending = true;
      setHistory((prev) => ({ ...prev, loading: true }));
      try {
        const batch = await marketData.fetchKlines({
          symbol,
          timeframe,
          limit: HISTORY_PAGE_SIZE,
          endTime: oldest * 1_000 - 1,
          signal: controller.signal,
        });
        if (cancelled) return;
        if (batch.length === 0) exhausted = true;
        // A scroll-triggered page is the one case the user is waiting to see,
        // so it goes straight to the chart.
        prependOlder(batch);
        commitOlder();
        publish();
      } catch (caught) {
        fail(caught);
      } finally {
        extending = false;
        if (!cancelled) {
          setHistory((prev) => ({ ...prev, loading: false, reachedStart: reachedStart() }));
        }
      }
    };

    void loadRecent().then(async () => {
      // Nothing loaded means the symbol failed outright; clear the history
      // spinner instead of leaving it running behind the error.
      if (cancelled || recent.length === 0) {
        if (!cancelled) setHistory((prev) => ({ ...prev, loading: false }));
        return;
      }
      unsubscribe = subscribeBinanceMarket(
        symbol,
        timeframe,
        (update) => {
          if (cancelled) return;
          if (update.candle) {
            recent = upsertLatestCandle(recent, update.candle);
            invalidate();
          }
          if (update.ticker) ticker = update.ticker;
          publish();
        },
        (status) => {
          if (!cancelled) setStreamStatus(status);
        },
      );
      pollTimer = setInterval(() => void pollLatest(), FALLBACK_POLL_MS);
      repaintRef.current = () => publish();
      await loadRange();
    });

    return () => {
      cancelled = true;
      repaintRef.current = null;
      controller.abort();
      unsubscribe?.();
      if (pollTimer) clearInterval(pollTimer);
      if (publishTimer) clearTimeout(publishTimer);
      loadMoreRef.current = async () => undefined;
    };
  }, [symbol, timeframe, range]);

  return { analysis, loading, error, streamStatus, history, loadMoreHistory, publishedTimeframe };
}

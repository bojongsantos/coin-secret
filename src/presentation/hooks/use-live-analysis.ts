"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import { loadMarketSnapshot } from "@/core/application/market-data/source-selection";
import { hasCandleGap, recoverRecentCandles } from "@/core/application/market-data/live-recovery";
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
import { isMarketExchange, type MarketExchange } from "@/core/domain/market/exchange";
import { TIMEFRAME_SECONDS } from "@/core/domain/market/timeframe";
import { applyRecentCandles, olderThan, upsertLatestCandle } from "@/core/domain/market/candles";
import type { AnalysisResult, Candle, MarketTicker, Timeframe } from "@/core/domain/models";
import { marketDataSources } from "@/infrastructure/market-data/market-data-provider";
import { useLocale } from "@/presentation/hooks/use-ui-preference";
import { normalizeReadFailure, readRetryDelay, responseReadFailure } from "@/shared/lib/read-failure";
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
const SETUP_TIMEOUT_MS = 10_000;
const DELAYED_AFTER_MS = 15_000;

export type ChartConnectionState = "live" | "polling" | "reconnecting" | "delayed";
export type ChartSetupState = "loading" | "published" | "missing" | "unavailable" | "mismatched" | "legacy";
type ChartPublishedSetup = PublishedSetup & { symbol: string; timeframe: Timeframe; status?: string };

function parseSetup(payload: unknown, symbol: string): ChartPublishedSetup | null {
  if (!payload || typeof payload !== "object" || !("setup" in payload)) throw new SyntaxError("Missing setup response");
  const value = (payload as { setup: unknown }).setup;
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new SyntaxError("Invalid setup response");
  const setup = value as Record<string, unknown>;
  const levels = [setup.entry, setup.target1, setup.target2, setup.stopLoss, setup.zoneTop, setup.zoneBottom, setup.zoneBaseTime];
  if (setup.symbol !== symbol || (setup.direction !== "long" && setup.direction !== "short")
    || typeof setup.timeframe !== "string" || !Object.hasOwn(TIMEFRAME_SECONDS, setup.timeframe)
    || levels.some((level) => typeof level !== "number" || !Number.isFinite(level) || level <= 0)
    || typeof setup.confidence !== "number" || !Number.isFinite(setup.confidence) || setup.confidence < 0 || setup.confidence > 100
    || (setup.zoneTop as number) < (setup.zoneBottom as number)
    || (setup.exchange != null && !isMarketExchange(setup.exchange))
    || (setup.status !== undefined && typeof setup.status !== "string")) {
    throw new SyntaxError("Invalid setup response");
  }
  return value as ChartPublishedSetup;
}

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
  connectionState: ChartConnectionState;
  lastUpdated: string | null;
  exchange: MarketExchange | null;
  setupState: ChartSetupState;
  setupError: string | null;
  retry: () => void;
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
  enabled = true,
): LiveAnalysis {
  // The analysis writes prose, so it needs the reader's language. The render
  // loop below closes over it and the effect lists it as a dependency, so a
  // language change rebuilds the analysis rather than waiting for a tick.
  const { locale } = useLocale();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<BinanceStreamStatus>("connecting");
  const [connectionState, setConnectionState] = useState<ChartConnectionState>("reconnecting");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [exchange, setExchange] = useState<MarketExchange | null>(null);
  const [setupState, setSetupState] = useState<ChartSetupState>("loading");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [history, setHistory] = useState<HistoryState>({
    loading: false,
    progress: null,
    truncated: false,
    reachedStart: false,
  });

  // The plan already published for this chart, fetched alongside the candles.
  // Held in a ref because every live tick re-renders from it and a state
  // update per tick would repaint the chart for no reason.
  const publishedRef = useRef<ChartPublishedSetup | null>(null);
  const [publishedTimeframe, setPublishedTimeframe] = useState<Timeframe | null>(null);
  // Set by the stream effect; lets a freshly fetched plan repaint immediately
  // instead of waiting for the next tick to arrive.
  const repaintRef = useRef<(() => void) | null>(null);

  const loadMoreRef = useRef<() => Promise<void>>(async () => undefined);
  const loadMoreHistory = useCallback(() => loadMoreRef.current(), []);
  const retryRef = useRef<() => void>(() => undefined);
  const retry = useCallback(() => retryRef.current(), []);

  // Switching symbol, timeframe or range starts a different chart entirely.
  // Resetting while rendering (React's documented "adjust state when a prop
  // changes" pattern) clears the previous market in the same commit, so the
  // old candles never flash under the new header.
  const viewKey = `${symbol}|${timeframe}|${range}|${enabled}|${reloadVersion}`;
  const [renderedKey, setRenderedKey] = useState(viewKey);
  if (viewKey !== renderedKey) {
    setRenderedKey(viewKey);
    setAnalysis(null);
    setError(null);
    setLoading(enabled);
    setStreamStatus("connecting");
    setConnectionState("reconnecting");
    setLastUpdated(null);
    setExchange(null);
    setSetupState("loading");
    setSetupError(null);
    setPublishedTimeframe(null);
    setHistory({ loading: true, progress: null, truncated: false, reachedStart: false });
  }

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let setupTimer: ReturnType<typeof setTimeout> | undefined;
    let setupPending: Promise<void> | null = null;
    let setupFailures = 0;
    let setupRetryAt = 0;
    let currentSetupState: ChartSetupState = "loading";
    let selectedData: MarketDataPort | null = null;
    let selectedExchange: MarketExchange | null = null;
    let publishedExchange: MarketExchange | undefined;
    let socketState: BinanceStreamStatus = "connecting";
    let freshAt = 0;
    let streamFreshAt = 0;
    let contiguous = true;
    let starting = false;
    let polling = false;
    let startupFailures = 0;

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
    publishedRef.current = null;

    function markFresh(stream = false) {
      freshAt = Date.now();
      if (stream) streamFreshAt = freshAt;
      setLastUpdated(new Date(freshAt).toISOString());
      setError(null);
      setConnectionState(stream || (socketState === "live" && freshAt - streamFreshAt < DELAYED_AFTER_MS) ? "live" : "polling");
    }

    /** A plan request is bounded and single-flight, including manual retries. */
    function loadPublished(): Promise<void> {
      if (setupPending) return setupPending;
      if (cancelled || navigator.onLine === false || document.visibilityState === "hidden" || Date.now() < setupRetryAt) return Promise.resolve();
      if (setupTimer) clearTimeout(setupTimer);
      setupPending = (async () => {
        let nextDelay = PUBLISHED_REFRESH_MS;
        try {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(SETUP_TIMEOUT_MS)]);
          const response = await fetch(`/api/setup?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store", signal });
          if (!response.ok) throw responseReadFailure(response.status, "Trading plan", response.headers.get("Retry-After"));
          const setup = parseSetup(await response.json(), symbol);
          if (cancelled) return;
          setupFailures = 0;
          setupRetryAt = 0;
          setSetupError(null);
          setPublishedTimeframe(setup?.timeframe ?? null);
          publishedExchange = setup?.exchange ?? undefined;
          publishedRef.current = setup?.timeframe === timeframe ? setup : null;
          currentSetupState = !setup ? "missing" : setup.timeframe !== timeframe ? "mismatched" : !setup.exchange ? "legacy" : "published";
          setSetupState(currentSetupState);
          if (setup?.exchange && selectedExchange && setup.exchange !== selectedExchange) {
            // A new published venue starts a fresh chart; never merge exchange tapes.
            setReloadVersion((version) => version + 1);
            return;
          }
          repaintRef.current?.();
        } catch (caught) {
          if (cancelled || controller.signal.aborted) return;
          const failure = normalizeReadFailure(caught, "Trading plan");
          publishedRef.current = null;
          publishedExchange = undefined;
          setPublishedTimeframe(null);
          currentSetupState = "unavailable";
          setSetupState(currentSetupState);
          setSetupError(failure.message);
          nextDelay = readRetryDelay(++setupFailures, PUBLISHED_REFRESH_MS, failure.retryAfterMs);
          setupRetryAt = Date.now() + failure.retryAfterMs;
          repaintRef.current?.();
        } finally {
          setupPending = null;
          if (!cancelled) setupTimer = setTimeout(() => void loadPublished(), nextDelay);
        }
      })();
      return setupPending;
    }

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
        selectedExchange === "bybit" ? "Bybit" : "Binance",
        candles.slice(-ANALYSIS_WINDOW_SIZE),
        ticker,
        publishedRef.current,
        locale,
        { publishedOnly: currentSetupState !== "missing" || !contiguous, evaluateLifecycle: contiguous && currentSetupState === "published", computePerformance: false },
      );
      setAnalysis({ ...result, chartData: { ...result.chartData, candles } });
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
      setError(normalizeReadFailure(caught, "Chart data").message);
      setConnectionState("delayed");
      if (recent.length === 0) {
        setAnalysis(null);
      }
    }

    /** Phase one: the newest window, so the chart is usable immediately. */
    async function loadRecent() {
      // Ask for the selected range, not a fixed page, so a short range never
      // arrives padded with history the user did not ask to see.
      const wanted = estimateRangeCandles(range, timeframe);
      const recentLimit = Math.min(HISTORY_PAGE_SIZE, wanted ?? HISTORY_PAGE_SIZE);
      try {
        const snapshot = await loadMarketSnapshot(marketDataSources, {
          symbol, timeframe, limit: recentLimit, signal: controller.signal,
        }, publishedExchange);
        if (cancelled) return;
        selectedData = snapshot.marketData;
        selectedExchange = snapshot.exchange;
        setExchange(selectedExchange);
        recent = snapshot.candles;
        contiguous = !hasCandleGap(recent, timeframe);
        invalidate();
        ticker = snapshot.ticker;
        if (contiguous) markFresh();
        else fail(new Error("Missing candle intervals"));
        render();
      } catch (caught) {
        fail(caught);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    /** Phase two: backfill the selected range behind the newest window. */
    async function loadRange() {
      if (!selectedData) return;
      try {
        listingSeconds = await fetchListingTime(selectedData, symbol, timeframe, controller.signal);
      } catch {
        listingSeconds = null;
      }
      if (cancelled) return;
      try {
        const loaded = await loadHistory({
          marketData: selectedData,
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
        contiguous = !hasCandleGap(series().slice(-ANALYSIS_WINDOW_SIZE), timeframe);
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
      if (starting || polling || !selectedData || cancelled || document.visibilityState === "hidden" || navigator.onLine === false) return;
      polling = true;
      try {
        const last = recent[recent.length - 1];
        // If a gap was observed, recover from the last verified bar rather
        // than from a socket frame that skipped the missing intervals.
        const gapIndex = contiguous ? -1 : recent.findIndex((candle, index) => index > 0 && candle.time - recent[index - 1].time !== TIMEFRAME_SECONDS[timeframe]);
        // Refresh the last closed bar too: a socket can open the next bar
        // after its final previous-bar message was lost.
        const recoveryStart = gapIndex > 0 ? recent[gapIndex - 1].time : (recent.at(-2)?.time ?? last.time);
        const reads = await Promise.allSettled([
          selectedData.fetchTicker24h(symbol, controller.signal),
          recoverRecentCandles(selectedData, symbol, timeframe, recoveryStart, Math.max(last.time, Math.floor(Date.now() / 1_000)), controller.signal),
        ] as const);
        if (reads[0].status === "rejected") throw reads[0].reason;
        if (reads[1].status === "rejected") throw reads[1].reason;
        const latestTicker = reads[0].value;
        const latest = reads[1].value;
        if (cancelled) return;
        ticker = latestTicker;
        recent = applyRecentCandles(recent, latest);
        contiguous = !hasCandleGap(recent.slice(-ANALYSIS_WINDOW_SIZE), timeframe);
        if (!contiguous) throw new Error("Missing candle intervals");
        invalidate();
        markFresh();
        publish();
      } catch (caught) {
        fail(caught);
      } finally {
        polling = false;
      }
    }

    /** Scroll-triggered paging further back than the loaded window. */
    loadMoreRef.current = async () => {
      const oldest = oldestTime();
      if (cancelled || !selectedData || extending || exhausted || oldest === null) return;
      extending = true;
      setHistory((prev) => ({ ...prev, loading: true }));
      try {
        const batch = await selectedData.fetchKlines({
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

    async function start() {
      if (starting || cancelled || document.visibilityState === "hidden" || navigator.onLine === false) return;
      if (recoveryTimer) clearTimeout(recoveryTimer);
      starting = true;
      await loadPublished();
      if (cancelled) { starting = false; return; }
      await loadRecent();
      starting = false;
      // Nothing loaded means the symbol failed outright; clear the history
      // spinner instead of leaving it running behind the error.
      if (cancelled || recent.length === 0) {
        if (!cancelled) {
          setHistory((prev) => ({ ...prev, loading: false }));
          recoveryTimer = setTimeout(() => void start(), readRetryDelay(++startupFailures, 30_000));
        }
        return;
      }
      if (selectedExchange === "binance") unsubscribe = subscribeBinanceMarket(
        symbol,
        timeframe,
        (update) => {
          if (cancelled) return;
          if (document.visibilityState === "hidden" || navigator.onLine === false) return;
          if (update.symbol !== symbol) return;
          // REST commits the pair atomically. A socket append during that
          // read would otherwise be overwritten by an older REST window.
          if (polling) return;
          const lastKnown = recent[recent.length - 1];
          if (lastKnown && Math.floor(Date.now() / 1_000) - lastKnown.time >= 2 * TIMEFRAME_SECONDS[timeframe]) {
            contiguous = false;
            setConnectionState("reconnecting");
            void pollLatest();
            return;
          }
          if (update.candle) {
            const last = recent[recent.length - 1];
            if (!contiguous || (last && update.candle.time > last.time + TIMEFRAME_SECONDS[timeframe])) {
              contiguous = false;
              setConnectionState("reconnecting");
              void pollLatest();
              return;
            }
            recent = upsertLatestCandle(recent, update.candle);
            invalidate();
          }
          if (update.ticker) ticker = update.ticker;
          if (!contiguous || (!update.candle && !update.ticker)) return;
          markFresh(true);
          publish();
        },
        (status) => {
          if (cancelled) return;
          const prior = socketState;
          socketState = status;
          setStreamStatus(status);
          if (status !== "live") setConnectionState("reconnecting");
          // An open socket says nothing about the missing candles. REST fills
          // the entire gap before lifecycle replay resumes.
          if (status === "live" && prior === "fallback") void pollLatest();
        },
      );
      else setStreamStatus("fallback");
      pollTimer = setInterval(() => {
        if (freshAt && Date.now() - freshAt >= DELAYED_AFTER_MS) setConnectionState("delayed");
        void pollLatest();
      }, FALLBACK_POLL_MS);
      repaintRef.current = () => publish();
      await loadRange();
    }

    function resume() {
      if (document.visibilityState === "hidden" || navigator.onLine === false) return;
      void loadPublished();
      contiguous = false;
      setConnectionState("reconnecting");
      if (recent.length > 0) void pollLatest();
      else void start();
    }
    function offline() {
      contiguous = false;
      setConnectionState("delayed");
    }
    retryRef.current = () => {
      void loadPublished();
      if (recent.length) void pollLatest();
      else void start();
    };
    void start();
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", resume);

    return () => {
      cancelled = true;
      repaintRef.current = null;
      controller.abort();
      unsubscribe?.();
      if (pollTimer) clearInterval(pollTimer);
      if (publishTimer) clearTimeout(publishTimer);
      if (recoveryTimer) clearTimeout(recoveryTimer);
      if (setupTimer) clearTimeout(setupTimer);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", resume);
      loadMoreRef.current = async () => undefined;
      retryRef.current = () => undefined;
    };
    // `locale` re-runs the effect so the prose is rewritten the moment the
    // language changes, rather than at the next tick.
  }, [symbol, timeframe, range, locale, enabled, reloadVersion]);

  return {
    analysis: enabled ? analysis : null, loading: enabled && loading, error: enabled ? error : null,
    streamStatus, connectionState, lastUpdated, exchange, setupState, setupError, retry,
    history, loadMoreHistory, publishedTimeframe: enabled ? publishedTimeframe : null,
  };
}

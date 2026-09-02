"use client";

import { useEffect, useState } from "react";
import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { rangeForTimeframe } from "@/core/application/market-data/history-plan";
import type { Timeframe } from "@/core/domain/models";
import { isValidBinanceSymbol, mergeSearchableSymbols, normalizeUsdtSymbol } from "@/core/domain/market/symbol";
import { fetchSearchableSymbols } from "@/infrastructure/market-data/symbol-catalog-client";
import { AnalysisView } from "@/presentation/features/analysis/analysis-view";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { useLiveAnalysis } from "@/presentation/hooks/use-live-analysis";
import { AppShell } from "@/presentation/layout/app-shell";
import { Loader2, RefreshCw } from "lucide-react";

export function AnalysisClient({
  initialSymbol,
  initialTimeframe,
}: {
  initialSymbol: string;
  initialTimeframe: Timeframe;
}) {
  // The same gate as the navbar. Leaving one way in open would make the
  // limit look like a bug rather than a plan.
  const { canAccess } = usePlan();
  const canSearch = canAccess("symbolSearch");
  const [symbol, setSymbol] = useState<string>(initialSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  // Not a reader's choice any more: how much history to load is decided by the
  // interval, so the chart always has at least as much market as the detector
  // that produced the row this page was opened from.
  const range = rangeForTimeframe(timeframe);
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
  const [query, setQuery] = useState(initialSymbol.replace(/USDT$/, ""));
  const { analysis, loading, error, streamStatus, history, loadMoreHistory, publishedTimeframe } =
    useLiveAnalysis(symbol, timeframe, range);

  // Move the chart to the interval the published plan was measured on, unless
  // the reader has picked one for this symbol themselves. Adjusting during
  // render is React's own pattern for "state derived from a changing input";
  // an effect would paint the wrong chart first and then correct it.
  const [chosenFor, setChosenFor] = useState<string | null>(null);
  if (publishedTimeframe && publishedTimeframe !== timeframe && chosenFor !== symbol) {
    setTimeframe(publishedTimeframe);
  }
  const chooseTimeframe = (next: Timeframe) => {
    setChosenFor(symbol);
    setTimeframe(next);
  };


  // The saved-favourites list is gone, so the catalogue is simply the market.
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setSymbols(mergeSearchableSymbols([], await fetchSearchableSymbols()));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filtered = query.trim()
    ? symbols.filter((s) => s.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30)
    : symbols.slice(0, 20);

  const pick = (value: string) => {
    const next = normalizeUsdtSymbol(value);
    if (!isValidBinanceSymbol(next)) return;
    setQuery(next.replace(/USDT$/i, ""));
    setSymbol(next);
  };

  return (
    <AppShell analysis={analysis}>
      <div className="flex flex-col gap-4 p-3 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-semibold text-muted">Symbol</label>
            <input
              list="symbol-options"
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                const match = symbols.find((s) => s.replace(/USDT$/, "").toUpperCase() === v.trim().toUpperCase());
                if (match) setSymbol(match);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") pick(e.currentTarget.value);
              }}
              disabled={!canSearch}
              placeholder={canSearch ? "Cari simbol…" : "Pencarian simbol tersedia di Pro"}
              className="w-56 rounded-lg border border-border bg-surface-3 px-3 py-1.5 text-[12px] font-semibold text-foreground placeholder:text-muted-2 focus:border-accent/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <datalist id="symbol-options">
              {filtered.map((s) => (
                <option key={s} value={s.replace(/USDT$/, "")}>
                  {s}
                </option>
              ))}
            </datalist>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="hidden"
              aria-hidden="true"
            >
              {symbols.map((s) => (
                <option key={s} value={s} />
              ))}
            </select>
          </div>
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-2">
              <Loader2 className="size-3.5 animate-spin" />
              Fetching live data…
            </span>
          )}
          {!loading && analysis && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-2">
              <RefreshCw className="size-3.5" />
              {streamStatus === "live" ? "Live · realtime stream" : "Live · reconnecting"}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-[12px] text-negative">
            Failed to load {symbol}: {error}
          </div>
        )}

        {!analysis && !error && (
          <div className="flex h-64 items-center justify-center text-muted-2">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}

        {analysis && (
          <AnalysisView
            data={analysis}
            timeframe={timeframe}
            onTimeframeChange={chooseTimeframe}
            range={range}
            history={history}
            onLoadMoreHistory={loadMoreHistory}
          />
        )}
      </div>
    </AppShell>
  );
}

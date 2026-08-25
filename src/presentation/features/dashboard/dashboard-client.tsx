"use client";

import { useState } from "react";
import type { HistoryRange } from "@/core/application/market-data/history-plan";
import { isValidBinanceSymbol, normalizeUsdtSymbol } from "@/core/domain/market/symbol";
import type { Timeframe } from "@/core/domain/models";
import { AnalysisView } from "@/presentation/features/analysis/analysis-view";
import { SupplyDemandSection } from "@/presentation/features/dashboard/supply-demand-section";
import { useLiveAnalysis } from "@/presentation/hooks/use-live-analysis";
import { useTopSetups } from "@/presentation/hooks/use-scanner";
import { MIN_DASHBOARD_CONFIDENCE } from "@/core/domain/analysis/signal-display";
import { useWatchlistMembership } from "@/presentation/hooks/use-watchlist-membership";
import { AppShell } from "@/presentation/layout/app-shell";
import { Loader2 } from "lucide-react";
import { CoinIcon } from "@/presentation/ui/coin-icon";

export function DashboardClient() {
  // The API applies the confidence floor before ranking, so this list and the
  // Signals tables cannot disagree on the same screen.
  const { top, loading: topLoading, error: topError } = useTopSetups(5);
  const membership = useWatchlistMembership();
  const [symbol, setSymbol] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [range, setRange] = useState<HistoryRange>("3M");

  // On a fresh mount, no session choice yet → auto-load today's #1 top setup.
  // Once the user picks a symbol it becomes the session choice (reset on the
  // next visit because state lives only in this component instance).
  const activeSymbol = symbol ?? top[0]?.hit.symbol ?? null;

  const { analysis, loading, error, history, loadMoreHistory } = useLiveAnalysis(
    activeSymbol ?? "BTCUSDT",
    timeframe,
    range,
  );

  const pick = (value: string) => {
    const normalized = normalizeUsdtSymbol(value);
    if (!isValidBinanceSymbol(normalized)) return;
    setSymbol(normalized);
  };

  const selectFromSection = (value: string) => setSymbol(value.toUpperCase());

  return (
    <AppShell analysis={analysis}>
      <div className="flex flex-col gap-4 p-3 sm:p-6">
        {/* Supply & Demand Zones — new top section */}
        <SupplyDemandSection onSelect={selectFromSection} membership={membership} />

        {loading && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-2">
            <Loader2 className="size-3.5 animate-spin" />
            Memuat data live…
          </span>
        )}

        {/* Top 5 setup — always visible; hiding it behind a toggle meant the
            single most useful thing on the page cost a click to reach. */}
        <section className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide">Top 5 setup hari ini</p>
            <span className="text-[10px] text-muted-2">diurutkan berdasarkan confidence</span>
          </div>

          {topLoading && (
            <div className="flex h-20 items-center justify-center text-muted-2">
              <Loader2 className="size-4 animate-spin" />
            </div>
          )}

          {!topLoading && top.length === 0 && (
            <p className="py-6 text-center text-[11px] text-muted-2">
              Belum ada setup dengan confidence di atas {MIN_DASHBOARD_CONFIDENCE}%.
            </p>
          )}

          {!topLoading && top.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {top.map((t) => {
                const up = t.hit.direction === "long";
                const activeCard = t.hit.symbol === activeSymbol;
                const confidence = Math.round(t.hit.confidence);
                return (
                  <button
                    key={t.hit.symbol}
                    type="button"
                    onClick={() => pick(t.hit.symbol)}
                    className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      activeCard
                        ? "border-accent/50 bg-accent/10"
                        : "border-border bg-surface-2 hover:border-accent/30 hover:bg-surface-3"
                    }`}
                  >
                    <span className="w-3 shrink-0 text-[10px] font-bold tabular-nums text-muted-2">
                      {t.rank}
                    </span>
                    <CoinIcon symbol={t.hit.symbol} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-bold leading-tight">
                        {t.hit.base}
                      </span>
                      <span
                        className={`mt-0.5 inline-block rounded border px-1 py-px text-[9px] font-bold uppercase leading-none ${
                          up
                            ? "border-positive/40 bg-positive/10 text-positive"
                            : "border-negative/40 bg-negative/10 text-negative"
                        }`}
                      >
                        {up ? "Long" : "Short"}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-[13px] font-bold leading-none tabular-nums ${
                        confidence >= 70
                          ? "text-positive"
                          : confidence >= 45
                            ? "text-warning"
                            : "text-muted"
                      }`}
                    >
                      {confidence}%
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {(error || topError) && (
          <div className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-[12px] text-negative">
            {(error ?? topError) as string}
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
            onTimeframeChange={setTimeframe}
            range={range}
            onRangeChange={setRange}
            history={history}
            onLoadMoreHistory={loadMoreHistory}
          />
        )}
      </div>
    </AppShell>
  );
}

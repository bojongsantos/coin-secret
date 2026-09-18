"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { rangeForTimeframe } from "@/core/application/market-data/history-plan";
import { isValidBinanceSymbol, normalizeUsdtSymbol } from "@/core/domain/market/symbol";
import type { Timeframe } from "@/core/domain/models";
import { AnalysisView } from "@/presentation/features/analysis/analysis-view";
import { MarketOverview } from "@/presentation/features/dashboard/market-overview";
import { TopSetupsStrip } from "@/presentation/features/dashboard/top-setups-strip";
import { SignalsBoard } from "@/presentation/features/signals/signals-board";
import { useLiveAnalysis } from "@/presentation/hooks/use-live-analysis";
import { useMarketContext } from "@/presentation/hooks/use-market-context";
import { useSdScan, useTopSetups } from "@/presentation/hooks/use-scanner";
import { AppShell } from "@/presentation/layout/app-shell";
import { Reveal } from "@/presentation/ui/reveal";

export function DashboardClient() {
  const { top, loading: topLoading } = useTopSetups(5);
  const { result, loading: scanLoading, error: scanError, failedCount, refresh } = useSdScan();
  const { context, sentiment } = useMarketContext(true);

  const [symbol, setSymbol] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const range = rangeForTimeframe(timeframe);

  // On a fresh mount nothing has been picked yet, so the page opens on the
  // day's leader rather than on an arbitrary default.
  const activeSymbol = symbol ?? top[0]?.hit.symbol ?? null;

  const { analysis, error, history, loadMoreHistory, publishedTimeframe } = useLiveAnalysis(
    activeSymbol ?? "BTCUSDT",
    timeframe,
    range,
  );

  // Move the chart to the interval the published plan was measured on, unless
  // the reader has picked one for this symbol themselves. Adjusting during
  // render is React's own pattern for state derived from a changing input; an
  // effect would paint the wrong chart first and then correct it.
  const [chosenFor, setChosenFor] = useState<string | null>(null);
  if (publishedTimeframe && publishedTimeframe !== timeframe && chosenFor !== activeSymbol) {
    setTimeframe(publishedTimeframe);
  }
  const chooseTimeframe = (next: Timeframe) => {
    setChosenFor(activeSymbol);
    setTimeframe(next);
  };

  const pick = (value: string, setupTimeframe?: Timeframe) => {
    const normalized = normalizeUsdtSymbol(value);
    if (!isValidBinanceSymbol(normalized)) return;
    setSymbol(normalized);
    // The scan reports which interval it found the setup on. Landing on a
    // different one shows an empty plan for a symbol the strip just called a
    // setup, which reads as a bug rather than as a different timeframe.
    if (setupTimeframe) setTimeframe(setupTimeframe);
  };

  return (
    <AppShell>
      {/* The blocks arrive in the order they are read, a beat apart. The stagger
          is per block rather than per card: a hundred rows each fading in on
          their own turns a board into a slot machine. */}
      <div className="flex flex-col gap-4 sm:gap-5">
        <Reveal>
          <MarketOverview
            context={context}
            sentiment={sentiment}
            analysis={analysis}
            onRefresh={refresh}
            refreshing={scanLoading}
          />
        </Reveal>

        <Reveal step={1}>
          <SignalsBoard
            demand={result?.demand ?? []}
            supply={result?.supply ?? []}
            demandTotal={result?.demandTotal ?? 0}
            supplyTotal={result?.supplyTotal ?? 0}
            loading={scanLoading}
            error={scanError}
            onRefresh={refresh}
            failedCount={failedCount}
            maxHeight={352}
          />
        </Reveal>

        <section className="cs-panel flex flex-col gap-6 p-4 sm:p-5">
        <Reveal step={2}>
          <TopSetupsStrip
            setups={top}
            loading={topLoading}
            activeSymbol={activeSymbol}
            onSelect={pick}
          />
        </Reveal>

        {error && (
          <div className="rounded-2xl border border-negative/30 bg-negative/10 px-4 py-3 text-[12.5px] text-negative">
            {error}
          </div>
        )}

        {!analysis && !error && (
          <div className="flex h-64 items-center justify-center text-muted-2">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}

        {analysis && (
          <Reveal step={3}>
            <AnalysisView
              data={analysis}
              timeframe={timeframe}
              onTimeframeChange={chooseTimeframe}
              range={range}
              history={history}
              onLoadMoreHistory={loadMoreHistory}
            />
          </Reveal>
        )}
        </section>
      </div>
    </AppShell>
  );
}

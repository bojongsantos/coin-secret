"use client";

import { useRef } from "react";

import type { HistoryRange } from "@/core/application/market-data/history-plan";
import type { AnalysisResult, Timeframe } from "@/core/domain/models";
import type { HistoryState } from "@/presentation/hooks/use-live-analysis";
import { priceDecimals } from "@/shared/lib/format";
import { AnalysisHeader } from "@/presentation/features/analysis/analysis-header";
import { ChartPanel } from "@/presentation/features/analysis/chart-panel";
import { PatternCard } from "@/presentation/features/analysis/pattern-card";
import { ReasoningCard } from "@/presentation/features/analysis/reasoning-card";

interface AnalysisViewProps {
  data: AnalysisResult;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  range: HistoryRange;
  history: HistoryState;
  onLoadMoreHistory: () => Promise<void>;
}

export function AnalysisView({
  data,
  timeframe,
  onTimeframeChange,
  range,
  history,
  onLoadMoreHistory,
}: AnalysisViewProps) {
  const precision = priceDecimals(data.pair.price);

  // Owned here so the header can snapshot the chart the panel renders.
  const captureRef = useRef<(() => HTMLCanvasElement | null) | null>(null);

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <AnalysisHeader
        pair={data.pair}
        timeframe={timeframe}
        analyzedAt={data.analyzedAt}
        pattern={data.pattern}
        levels={data.levels}
        riskReward={data.riskReward}
        captureRef={captureRef}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ChartPanel
          data={data.chartData}
          timeframe={timeframe}
          onTimeframeChange={onTimeframeChange}
          symbol={data.pair.symbol}
          precision={precision}
          price={data.pair.price}
          change24h={data.pair.change24h}
          pattern={data.pattern}
          levels={data.levels}
          range={range}
          history={history}
          onLoadMoreHistory={onLoadMoreHistory}
          captureRef={captureRef}
        />
        <PatternCard
          pattern={data.pattern}
          levels={data.levels}
          riskReward={data.riskReward}
          precision={precision}
        />
      </div>

      <ReasoningCard sections={data.reasoning} />
    </div>
  );
}

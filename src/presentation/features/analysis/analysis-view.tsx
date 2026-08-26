"use client";

import { useRef } from "react";

import type { HistoryRange } from "@/core/application/market-data/history-plan";
import type { AnalysisResult, Timeframe } from "@/core/domain/models";
import type { HistoryState } from "@/presentation/hooks/use-live-analysis";
import { buildSignalPerformance } from "@/core/domain/analysis/signal-performance";
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
  onRangeChange: (range: HistoryRange) => void;
  history: HistoryState;
  onLoadMoreHistory: () => Promise<void>;
}

export function AnalysisView({
  data,
  timeframe,
  onTimeframeChange,
  range,
  onRangeChange,
  history,
  onLoadMoreHistory,
}: AnalysisViewProps) {
  const precision = priceDecimals(data.pair.price);

  // Measured from the candles already loaded for the chart, so the exported
  // image can say what the setup did rather than only what it proposed.
  const entryLevel = data.levels.find((level) => level.id === "entry");
  const target1 = data.levels.find((level) => level.id === "target-1");
  const target2 = data.levels.find((level) => level.id === "target-2");
  const stop = data.levels.find((level) => level.id === "sl");
  // Anchored to the bar the zone formed on, not to `detectedAt`: the analysis
  // is rebuilt on every request, so its timestamp is always the present moment
  // and would leave no bars after the signal to measure.
  const setupShape = data.pattern.shape?.setup;
  const signalZone = data.pattern.shape?.zones?.find((zone) => zone.id === setupShape?.zoneId);
  const performance =
    signalZone && entryLevel && target1 && target2 && stop
      ? buildSignalPerformance({
          candles: data.chartData.candles,
          signalTime: signalZone.baseTime,
          direction: data.pattern.trend === "bearish" ? "short" : "long",
          entry: entryLevel.price,
          target1: target1.price,
          target2: target2.price,
          stopLoss: stop.price,
        })
      : null;
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
        performance={performance}
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
          onRangeChange={onRangeChange}
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

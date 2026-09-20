"use client";

import { useRef, useState } from "react";

import type { HistoryRange } from "@/core/application/market-data/history-plan";
import type { AnalysisResult, Timeframe } from "@/core/domain/models";
import type { HistoryState } from "@/presentation/hooks/use-live-analysis";
import { priceDecimals } from "@/shared/lib/format";
import { composeShareImage } from "@/presentation/features/analysis/share-image";
import { ChartPanel } from "@/presentation/features/analysis/chart-panel";
import { PatternCard } from "@/presentation/features/analysis/pattern-card";
import { ReasoningCard } from "@/presentation/features/analysis/reasoning-card";
import { useT } from "@/presentation/hooks/use-translate";
import type { MessageKey } from "@/shared/i18n/messages";

interface AnalysisViewProps {
  data: AnalysisResult;
  dashboard?: boolean;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  range: HistoryRange;
  history: HistoryState;
  onLoadMoreHistory: () => Promise<void>;
}

type ShareState = "idle" | "working" | "done" | "error";

const SHARE_LABEL: Record<ShareState, MessageKey> = {
  idle: "chart.download",
  working: "chart.downloadWorking",
  done: "chart.downloadDone",
  error: "chart.downloadFailed",
};

/**
 * Chart, plan and reasoning — the three blocks the design puts on a coin.
 *
 * There is no header row above them: the chart panel carries the pair, its
 * price and the interval switch, which is where a reader looks for them
 * anyway. The export sits beside the interval switch for the same reason.
 */
export function AnalysisView({
  data,
  dashboard = false,
  timeframe,
  onTimeframeChange,
  range,
  history,
  onLoadMoreHistory,
}: AnalysisViewProps) {
  const { t } = useT();
  const precision = priceDecimals(data.pair.price);
  const [share, setShare] = useState<ShareState>("idle");

  // Owned here so the export can photograph the chart the panel renders.
  const captureRef = useRef<(() => HTMLCanvasElement | null) | null>(null);

  /**
   * Exports the chart and its trade plan as one image, saved straight to the
   * device. The Web Share sheet used to intercept this, which turned a one-tap
   * save into a target picker the reader had to dismiss.
   */
  async function download() {
    const chart = captureRef.current?.();
    if (!chart) {
      setShare("error");
      window.setTimeout(() => setShare("idle"), 2_000);
      return;
    }
    setShare("working");
    try {
      const blob = await composeShareImage({
        chart,
        symbol: data.pair.symbol,
        timeframe,
        price: data.pair.price,
        change24h: data.pair.change24h,
        pattern: data.pattern,
        levels: data.levels,
        riskReward: data.riskReward,
      });
      if (!blob) throw new Error(t("chart.imageFailed"));

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${data.pair.symbol}-${timeframe}-coin-secret.png`;
      // Firefox ignores a click on a link that is not in the document, and the
      // object URL must outlive the click for the download to start.
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setShare("done");
    } catch {
      setShare("error");
    }
    window.setTimeout(() => setShare("idle"), 2_000);
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="cs-analysis-grid">
        <ChartPanel
          data={data.chartData}
          dashboard={dashboard}
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
          onDownload={() => void download()}
          downloadBusy={share === "working"}
          downloadLabel={t(SHARE_LABEL[share])}
        />
        <PatternCard
          pattern={data.pattern}
          levels={data.levels}
          riskReward={data.riskReward}
          precision={precision}
        />
      </div>

      <ReasoningCard sections={data.reasoning} prominent={dashboard} />
    </div>
  );
}

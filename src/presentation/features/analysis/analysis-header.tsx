"use client";

import { useState, type MutableRefObject } from "react";
import { CalendarDays, Download, Loader2 } from "lucide-react";
import type { PairSummary, PatternSummary, Timeframe, TradeLevel } from "@/core/domain/models";
import { composeShareImage } from "@/presentation/features/analysis/share-image";
import { useT } from "@/presentation/hooks/use-translate";
import type { MessageKey } from "@/shared/i18n/messages";

interface AnalysisHeaderProps {
  pair: PairSummary;
  timeframe: Timeframe;
  analyzedAt: string;
  pattern: PatternSummary;
  levels: TradeLevel[];
  riskReward: number;
  captureRef: MutableRefObject<(() => HTMLCanvasElement | null) | null>;
}

type ShareState = "idle" | "working" | "done" | "error";

const LABEL: Record<ShareState, MessageKey> = {
  idle: "chart.download",
  working: "chart.downloadWorking",
  done: "chart.downloadDone",
  error: "chart.downloadFailed",
};

export function AnalysisHeader({
  pair,
  timeframe,
  analyzedAt,
  pattern,
  levels,
  riskReward,
  captureRef,
}: AnalysisHeaderProps) {
  const { t, locale } = useT();
  const [state, setState] = useState<ShareState>("idle");
  const date = new Date(analyzedAt);
  // The date is formatted in the reader's own language too: "7 Sep 2026" and
  // "Sep 7, 2026" are the same day written the way each reader expects it.
  const dateLabel = date.toLocaleDateString(locale === "id" ? "id-ID" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  /**
   * Exports the chart and its trade plan as one image and saves it straight to
   * the device. The Web Share sheet used to intercept this, which turned a
   * one-tap save into a target picker the user had to dismiss.
   */
  async function share() {
    const chart = captureRef.current?.();
    if (!chart) {
      setState("error");
      window.setTimeout(() => setState("idle"), 2_000);
      return;
    }
    setState("working");
    try {
      const blob = await composeShareImage({
        chart,
        symbol: pair.symbol,
        timeframe,
        price: pair.price,
        change24h: pair.change24h,
        pattern,
        levels,
        riskReward,
            });
      if (!blob) throw new Error(t("chart.imageFailed"));

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${pair.symbol}-${timeframe}-coin-secret.png`;
      // Firefox ignores a click on a link that is not in the document, and the
      // object URL must outlive the click for the download to start.
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState("done");
    } catch {
      setState("error");
    }
    window.setTimeout(() => setState("idle"), 2_000);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold tracking-tight">{pair.symbol}</h1>
          <span className={`text-[13px] font-semibold ${pair.change24h >= 0 ? "text-positive" : "text-negative"}`}>
            {pair.change24h >= 0 ? "+" : ""}
            {pair.change24h.toFixed(2)}%
          </span>
        </div>
      </div>

      <span className="ml-2 inline-flex items-center gap-1.5 text-[12px] text-muted-2">
        <CalendarDays className="size-3.5" />
        {t("chart.analyzedAt", { date: dateLabel })}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => void share()}
          disabled={state === "working"}
          title={t("chart.downloadTitle")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-3 px-3.5 py-2 text-[12px] font-semibold text-foreground transition-colors hover:border-border-strong disabled:opacity-60"
        >
          {state === "working" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {t(LABEL[state])}
        </button>
      </div>
    </div>
  );
}

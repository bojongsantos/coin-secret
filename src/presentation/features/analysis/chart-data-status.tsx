"use client";

import { RefreshCw } from "lucide-react";
import type { LiveAnalysis } from "@/presentation/hooks/use-live-analysis";
import { useT } from "@/presentation/hooks/use-translate";
import type { MessageKey } from "@/shared/i18n/messages";

type ChartDataStatusProps = Pick<LiveAnalysis,
  "connectionState" | "exchange" | "lastUpdated" | "setupState" | "setupError" | "retry"
>;

const CONNECTION_LABEL: Record<LiveAnalysis["connectionState"], MessageKey> = {
  live: "chart.connectionLive",
  polling: "chart.connectionPolling",
  reconnecting: "chart.connectionReconnecting",
  delayed: "chart.connectionDelayed",
};

const SETUP_LABEL: Partial<Record<LiveAnalysis["setupState"], MessageKey>> = {
  loading: "chart.setupLoading",
  missing: "chart.setupLocal",
  unavailable: "chart.setupUnavailable",
  mismatched: "chart.setupMismatched",
  legacy: "chart.setupLegacy",
};

/** A fresh price does not imply that the trading plan or its history is verified. */
export function ChartDataStatus({ connectionState, exchange, lastUpdated, setupState, setupError, retry }: ChartDataStatusProps) {
  const { t, locale } = useT();
  const delayed = connectionState === "delayed" || connectionState === "reconnecting";
  const warning = setupState === "unavailable" || setupState === "legacy" || setupState === "mismatched";
  const time = lastUpdated ? new Date(lastUpdated) : null;
  const validTime = time && Number.isFinite(time.getTime()) ? time : null;
  const setupLabel = SETUP_LABEL[setupState];

  return (
    <div className="flex flex-col gap-2 text-[11px] text-muted-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`inline-flex items-center gap-1.5 ${delayed ? "text-warning" : "text-positive"}`}>
          <span className={`size-1.5 rounded-full ${delayed ? "bg-warning" : "bg-positive"}`} aria-hidden="true" />
          {t(CONNECTION_LABEL[connectionState])}
        </span>
        {exchange && <span>{exchange === "binance" ? "Binance" : "Bybit"} · Spot</span>}
        {validTime && (
          <span>{t("data.lastUpdated")} <time dateTime={validTime.toISOString()}>{validTime.toLocaleTimeString(locale === "id" ? "id-ID" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></span>
        )}
        {(delayed || setupState === "unavailable") && (
          <button type="button" onClick={retry} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-foreground hover:bg-white/5">
            <RefreshCw className="size-3" aria-hidden="true" />{t("common.retry")}
          </button>
        )}
      </div>
      {setupLabel && (
        <p className={warning ? "rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-warning" : "text-muted-2"}>
          {t(setupLabel)}{setupState === "unavailable" && setupError ? ` ${setupError}` : ""}
        </p>
      )}
    </div>
  );
}

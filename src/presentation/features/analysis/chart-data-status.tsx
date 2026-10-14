"use client";

import { Clock3, Loader2, RefreshCw } from "lucide-react";
import type { LiveAnalysis } from "@/presentation/hooks/use-live-analysis";
import { useT } from "@/presentation/hooks/use-translate";
import type { MessageKey } from "@/shared/i18n/messages";

type ChartDataStatusProps = Pick<LiveAnalysis,
  "connectionState" | "exchange" | "lastUpdated" | "setupState" | "setupError" | "retry"
> & { historyError?: string | null };

const SETUP_LABEL: Partial<Record<LiveAnalysis["setupState"], MessageKey>> = {
  missing: "chart.setupLocal",
  unavailable: "chart.setupUnavailable",
  mismatched: "chart.setupMismatched",
  legacy: "chart.setupLegacy",
};

/** A fresh price does not imply that the trading plan or its history is verified. */
export function ChartDataStatus({ connectionState, setupState, setupError, historyError, retry }: ChartDataStatusProps) {
  const { t } = useT();
  const reconnecting = connectionState === "reconnecting";
  const delayed = connectionState === "delayed";
  const loading = reconnecting || setupState === "loading";
  const warning = setupState === "unavailable" || setupState === "legacy" || setupState === "mismatched";
  const setupLabel = SETUP_LABEL[setupState];
  const status = [
    reconnecting ? t("chart.connectionReconnecting") : delayed ? t("chart.connectionDelayed") : null,
    setupState === "loading" ? t("chart.setupLoading") : null,
    historyError ? t("chart.historyUnavailable") : null,
  ].filter(Boolean).join(" ");
  const canRetry = !reconnecting && (delayed || Boolean(historyError) || setupState === "unavailable");
  if (!status && !setupLabel) return null;

  return (
    <div role="status" className="flex flex-col gap-2 text-[11px] text-muted-2">
      {(status || canRetry) && (
        <div className="flex items-center gap-2">
          {status && (
            <span title={status} className="inline-flex items-center">
              {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Clock3 className="size-4" aria-hidden="true" />}
              <span className="sr-only">{status}</span>
            </span>
          )}
          {canRetry && (
            <button type="button" onClick={retry} title={t("common.retry")} aria-label={t("common.retry")} className="inline-flex size-7 items-center justify-center rounded-md hover:text-foreground">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{t("common.retry")}</span>
            </button>
          )}
        </div>
      )}
      {setupLabel && (
        <p className={warning ? "rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-warning" : "text-muted-2"}>
          {t(setupLabel)}{setupState === "unavailable" && setupError ? ` ${setupError}` : ""}
        </p>
      )}
    </div>
  );
}

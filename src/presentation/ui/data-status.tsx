"use client";

import { Clock3, Loader2, RefreshCw } from "lucide-react";
import { useT } from "@/presentation/hooks/use-translate";

/** Availability is separate from a successful response containing no results. */
export function DataStatus({
  error,
  stale = false,
  loading = false,
  onRetry,
}: {
  error?: string | null;
  stale?: boolean;
  lastUpdated?: string | null;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useT();
  if (loading || stale) {
    const status = t(loading ? "common.loading" : "data.stale");
    return (
      <div role="status" title={status} className="mt-3 flex items-center gap-2 text-muted-2">
        {loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Clock3 aria-hidden="true" className="size-4" />}
        <span className="sr-only">{status}{stale && loading ? ` ${t("data.stale")}` : ""}{error ? ` ${error}` : ""}</span>
        {!loading && onRetry && (
          <button type="button" onClick={onRetry} title={t("common.retry")} aria-label={t("common.retry")} className="inline-flex size-7 items-center justify-center rounded-md hover:text-foreground">
            <RefreshCw aria-hidden="true" className="size-3.5" />
          </button>
        )}
      </div>
    );
  }
  if (!error) return null;

  return (
    <div role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
      <span>{t("data.unavailable")}</span>
      <span>{error}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-auto rounded-md border border-current px-2.5 py-1 text-[11px]">
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

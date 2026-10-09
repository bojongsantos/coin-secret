"use client";

import { useT } from "@/presentation/hooks/use-translate";

/** Availability is separate from a successful response containing no results. */
export function DataStatus({
  error,
  stale = false,
  lastUpdated,
  loading = false,
  onRetry,
}: {
  error?: string | null;
  stale?: boolean;
  lastUpdated?: string | null;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const { t, locale } = useT();
  if (!error && !stale && !lastUpdated) return null;

  return (
    <div role="status" className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2 text-[12px] ${error || stale ? "border border-warning/30 bg-warning/10 text-warning" : "text-muted-2"}`}>
      {(error || stale) && <span>{t(stale ? "data.stale" : "data.unavailable")}</span>}
      {error && <span>{error}</span>}
      {lastUpdated && (
        <span>
          {t("data.lastUpdated")} {" "}
          <time dateTime={lastUpdated}>{new Date(lastUpdated).toLocaleTimeString(locale === "id" ? "id-ID" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
        </span>
      )}
      {(error || stale) && onRetry && (
        <button type="button" onClick={onRetry} disabled={loading} className="ml-auto rounded-md border border-current px-2.5 py-1 text-[11px] disabled:opacity-50">
          {t(loading ? "common.loading" : "common.retry")}
        </button>
      )}
    </div>
  );
}

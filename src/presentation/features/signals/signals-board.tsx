"use client";

import Image from "next/image";
import Link from "next/link";
import {
  CandlestickChart,
  Check,
  Loader2,
  Lock,
  RefreshCw,
} from "lucide-react";
import type { SdScanHit } from "@/core/application/scanner/supply-demand-scan-service";
import { useT, type Translate } from "@/presentation/hooks/use-translate";
import { CoinIcon } from "@/presentation/ui/coin-icon";
import { statusMessageKey, type MessageKey } from "@/shared/i18n/messages";
import { formatCompact } from "@/shared/lib/format";

/**
 * The tone each status is shown in. Terminal outcomes are not neutral news:
 * a stop taken reads red, a target reached reads green.
 */
/**
 * The mark each status carries.
 *
 * The chip itself stays dark and only the mark is coloured. A column of
 * saturated pills competed with the confidence figure beside it, which is the
 * number the row exists to show.
 */
const STATUS_MARK: Record<string, string> = {
  "Limit Order": "limit-order",
  Filled: "filled",
  Running: "running",
  "Target 1 reached": "target-1-reached",
  "Target 2 reached": "target-1-reached",
  "Invalidated (SL hit)": "bearish",
  Missed: "bearish",
  Bullish: "bullish",
  Bearish: "bearish",
};

function StatusPill({ status, t }: { status: string; t: Translate }) {
  const key = statusMessageKey(status);
  const mark = STATUS_MARK[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2 py-1.5 text-[9px] font-medium text-foreground">
      {mark ? (
        <Image
          src={`/icons/status/${mark}.png`}
          alt=""
          width={17}
          height={16}
          unoptimized
          className="h-4 w-[17px] shrink-0 object-contain"
        />
      ) : (
        <Check className="size-3 shrink-0 text-muted-2" aria-hidden />
      )}
      {key ? t(key) : status}
    </span>
  );
}

/** Volume as a bar relative to the largest row in this column, plus the figure. */
function VolumeBar({ volume, max }: { volume: number; max: number }) {
  const percent = Math.max(4, Math.min(100, (volume / Math.max(max, 1)) * 100));
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-full max-w-[150px] overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-blue/70 to-accent-blue"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-[9px] font-medium tabular-nums text-muted">
        {formatCompact(volume)}
      </span>
    </div>
  );
}

/**
 * One setup.
 *
 * The standalone board links to a separate analysis tab. On the dashboard the
 * same row becomes a button that selects the chart already present below it.
 */
function SetupRowContent({ hit, max, t }: { hit: SdScanHit; max: number; t: Translate }) {
  const up = hit.change24h >= 0;
  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5">
        <CoinIcon symbol={hit.symbol} size={26} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold leading-tight">
            {hit.base}
            <span className="text-[9px] font-medium text-muted-2">/USDT</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[9px] leading-tight tabular-nums">
            <span className={up ? "text-positive" : "text-negative"}>
              {up ? "+" : ""}
              {hit.change24h.toFixed(2)}%
            </span>
            <span className="rounded bg-surface-3 px-1.5 py-px font-bold text-muted">
              {hit.timeframe}
            </span>
          </p>
        </div>
      </div>

      <div className="hidden min-w-0 sm:block">
        <VolumeBar volume={hit.volume24h} max={max} />
      </div>

      <span
        className={`text-center text-[12px] font-bold tabular-nums ${
          hit.direction === "long" ? "text-positive" : "text-negative"
        }`}
      >
        {Math.round(hit.confidence)}%
      </span>

      <div className="flex justify-center">
        <StatusPill status={hit.status} t={t} />
      </div>
    </>
  );
}

const ROW_CLASS =
  "cs-signal-row grid w-full items-center gap-2 rounded-lg py-2.5 text-left transition-colors hover:bg-surface-3/70";

function SetupRow({
  hit,
  max,
  t,
  onSelect,
}: {
  hit: SdScanHit;
  max: number;
  t: Translate;
  onSelect?: (symbol: string, timeframe: SdScanHit["timeframe"]) => void;
}) {
  return onSelect ? (
    <button type="button" onClick={() => onSelect(hit.symbol, hit.timeframe)} className={ROW_CLASS}>
      <SetupRowContent hit={hit} max={max} t={t} />
    </button>
  ) : (
    <Link
      href={`/analysis?symbol=${encodeURIComponent(hit.symbol)}&tf=${encodeURIComponent(hit.timeframe)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={ROW_CLASS}
    >
      <SetupRowContent hit={hit} max={max} t={t} />
    </Link>
  );
}

function Column({
  title,
  hits,
  totalCount,
  t,
  maxHeight,
  onSelect,
}: {
  title: MessageKey;
  hits: SdScanHit[];
  totalCount: number;
  t: Translate;
  maxHeight: number;
  onSelect?: (symbol: string, timeframe: SdScanHit["timeframe"]) => void;
}) {
  const max = Math.max(1, ...hits.map((hit) => hit.volume24h));
  const hiddenCount = Math.max(0, totalCount - hits.length);
  const showBlurredPreview = hiddenCount > 0 && Boolean(onSelect) && hits.length > 0;
  const previewHits = showBlurredPreview ? [hits[0], hits[1] ?? hits[0]] : [];
  return (
    <section className="cs-card flex min-w-0 flex-col p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold tracking-tight">{t(title)}</h3>
        {!showBlurredPreview && (
          <span className="text-[11px] text-muted-2">{t("zones.setupCount", { count: totalCount })}</span>
        )}
      </div>

      <div className="cs-signal-labels mt-5 hidden gap-2 pb-2 text-[8px] font-medium uppercase text-muted sm:grid">
        <span>{t("zones.pair")}</span>
        <span>{t("zones.volume24h")}</span>
        <span className="text-center">{t("zones.confidence")}</span>
        <span className="text-center">{t("zones.status")}</span>
      </div>

      {/* The board carries a couple of hundred pairs; the column scrolls
          rather than the page growing to the length of the longest side. */}
      <div
        className={`-mx-1 min-h-[220px] px-1 ${showBlurredPreview ? "overflow-hidden" : "scrollbar-thin overflow-y-auto"}`}
        style={showBlurredPreview ? undefined : { maxHeight }}
      >
        {hits.length === 0 ? (
          <p className="px-3 py-10 text-center text-[12px] text-muted-2">{t("zones.empty")}</p>
        ) : (
          <div className="space-y-0.5">
            {hits.map((hit) => (
              <SetupRow key={`${hit.symbol}-${hit.timeframe}`} hit={hit} max={max} t={t} onSelect={onSelect} />
            ))}
          </div>
        )}
        {showBlurredPreview && (
          <div
            aria-hidden="true"
            className="relative h-[108px] select-none overflow-hidden [mask-image:linear-gradient(to_bottom,black_0%,black_32%,transparent_96%)]"
          >
            <div className="space-y-0.5 opacity-55 blur-[3px]">
              {previewHits.map((hit, index) => (
                <div key={`${hit.symbol}-${hit.timeframe}-preview-${index}`} className={ROW_CLASS}>
                  <SetupRowContent hit={hit} max={max} t={t} />
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-surface-2/90" />
          </div>
        )}
      </div>
      {hiddenCount > 0 && (
        <Link
          href="/pricing"
          className="cs-primary mt-4 flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold text-white"
          title={t("zones.moreSetups", { count: hiddenCount })}
        >
          <Lock className="size-3.5" aria-hidden /> {t("common.unlockPro")}
        </Link>
      )}
    </section>
  );
}

/**
 * The full signals board.
 *
 * Free readers receive three rows per side from the API. The totals let the UI
 * state plainly how many more are available without sending those rows.
 */
export function SignalsBoard({
  demand,
  supply,
  demandTotal = demand.length,
  supplyTotal = supply.length,
  loading,
  error,
  onRefresh,
  failedCount = 0,
  maxHeight = 600,
  onSelect,
}: {
  demand: SdScanHit[];
  supply: SdScanHit[];
  demandTotal?: number;
  supplyTotal?: number;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  failedCount?: number;
  /** How tall each column may grow before it scrolls on its own. */
  maxHeight?: number;
  /** Dashboard rows select the chart in place; the standalone page omits this and opens analysis separately. */
  onSelect?: (symbol: string, timeframe: SdScanHit["timeframe"]) => void;
}) {
  const { t } = useT();
  return (
    <div className="cs-panel relative p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-[20px] font-bold tracking-tight sm:text-[22px]">
          <CandlestickChart className="size-5 text-accent-blue" />
          {t("nav.signals")}
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="cs-primary inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {t("common.refresh")}
        </button>
      </div>

      {(error || failedCount > 0) && (
        <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[12px] text-warning">
          {error ?? t("scan.partialFailure", { count: failedCount })}
        </p>
      )}

      <div className="mt-7 grid gap-3.5 xl:grid-cols-2 [&>*]:min-w-0">
        <Column title="signals.longSetup" hits={demand} totalCount={demandTotal} t={t} maxHeight={maxHeight} onSelect={onSelect} />
        <Column title="signals.shortSetup" hits={supply} totalCount={supplyTotal} t={t} maxHeight={maxHeight} onSelect={onSelect} />
      </div>
    </div>
  );
}

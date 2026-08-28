"use client";

import { useRouter } from "next/navigation";
import { Layers, Loader2, RefreshCw } from "lucide-react";
import type { SdScanHit } from "@/core/application/scanner/supply-demand-scan-service";
import { MIN_DASHBOARD_CONFIDENCE } from "@/core/domain/analysis/signal-display";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { useSdScan } from "@/presentation/hooks/use-scanner";
import { Badge } from "@/presentation/ui/badge";
import type { Timeframe } from "@/core/domain/models";
import { CoinIcon } from "@/presentation/ui/coin-icon";
import { LockedOverlay } from "@/presentation/ui/locked-overlay";
import { formatCompact } from "@/shared/lib/format";

const FREE_VISIBLE = 3;
const SCROLL_MAX_HEIGHT = 400; // ~6 rows visible at once

const STATUS_TONES: Record<string, "warning" | "blue" | "positive" | "negative" | "neutral"> = {
  "Limit Order": "warning",
  Filled: "blue",
  Running: "positive",
  "Target 1 reached": "positive",
  "Target 2 reached": "positive",
  "Invalidated (SL hit)": "negative",
  Missed: "neutral",
};

function statusTone(status?: string) {
  return STATUS_TONES[status ?? ""] ?? "neutral";
}

/** Horizontal volume bar relative to the largest setup in the table. */
function VolumeBar({ volume, max }: { volume: number; max: number }) {
  const pct = Math.max(3, (volume / Math.max(max, 1)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-blue/60 to-accent-blue"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-7 text-right text-[9px] font-semibold tabular-nums text-muted">{formatCompact(volume)}</span>
    </div>
  );
}

function ZoneRow({
  hit,
  color,
  maxVol,
  onSelect,
}: {
  hit: SdScanHit;
  color: string;
  maxVol: number;
  onSelect?: (symbol: string, timeframe: Timeframe) => void;
}) {
  return (
    <tr
      data-zone-row={hit.symbol}
      onClick={onSelect ? () => onSelect(hit.symbol, hit.timeframe) : undefined}
      className={`group border-b border-border/50 transition-colors last:border-b-0 hover:bg-surface-2/60 ${
        onSelect ? "cursor-pointer" : ""
      }`}
    >
      <td className="px-1.5 py-2">
        <div className="flex items-center gap-1.5">
          <CoinIcon symbol={hit.symbol} size={24} />
          <span>
            <span className="block text-[11px] font-bold leading-tight transition-colors group-hover:text-accent-2">
              {hit.base}
              <span className="font-medium text-muted-2">/USDT</span>
            </span>
            <span className="flex items-center gap-1 text-[9px] tabular-nums text-muted-2">
              <span>
                {hit.change24h >= 0 ? "+" : ""}
                {hit.change24h.toFixed(2)}%
              </span>
              {/* Which chart the setup lives on. The scan reads four of them,
                  and a plan only means anything next to its own interval. */}
              <span className="rounded bg-surface-3 px-1 py-px font-bold text-muted">
                {hit.timeframe}
              </span>
            </span>
          </span>
        </div>
      </td>
      <td className="px-1.5 py-2">
        <VolumeBar volume={hit.volume24h} max={maxVol} />
      </td>
      <td className="px-1.5 py-2">
        {hit.status && <Badge tone={statusTone(hit.status)}>{hit.status}</Badge>}
      </td>
      <td className="px-1.5 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <span className="text-[11px] font-bold tabular-nums" style={{ color }}>
            {hit.confidence}%
          </span>
          <div className="h-1 w-5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full" style={{ background: color, width: `${hit.confidence}%` }} />
          </div>
        </div>
      </td>
    </tr>
  );
}

function ZoneCard({
  title,
  hits,
  totalCount,
  tone,
  onSelect,
}: {
  title: string;
  hits: SdScanHit[];
  totalCount?: number;
  tone: "green" | "red";
  onSelect?: (symbol: string, timeframe: Timeframe) => void;
}) {
  const router = useRouter();
  const { canAccess } = usePlan();
  const extended = canAccess("scannerExtended");
  const color = tone === "green" ? "var(--color-positive)" : "var(--color-negative)";
  // Defensive: never mix directions — Buy table only shows long, Sell only short.
  const filtered = hits.filter((h) => (tone === "green" ? h.direction === "long" : h.direction === "short"));
  const total = totalCount ?? filtered.length;
  const hasMore = total > FREE_VISIBLE;
  // Premium sees every setup; Free sees the first FREE_VISIBLE.
  // and the rest blur inside the same scroll area.
  const visible = extended ? filtered : filtered.slice(0, FREE_VISIBLE);
  const hiddenCount = extended ? 0 : Math.max(0, total - visible.length);
  const scrollActive = total > FREE_VISIBLE;
  const maxVol = Math.max(1, ...filtered.map((h) => h.volume24h));

  return (
    <section className="card flex min-w-0 flex-col p-4 sm:p-6" style={{ borderRadius: 12 }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold tracking-tight" style={{ color }}>
          {title}
        </h3>
        <span className="text-[11px] text-muted-2">{total} setup</span>
      </div>

      {/* Internal scroll area — header/footer stay fixed outside this box */}
      <div
        className="relative mt-3 overflow-y-auto rounded-lg border border-border bg-surface"
        style={{
          maxHeight: scrollActive ? SCROLL_MAX_HEIGHT : undefined,
          scrollBehavior: "smooth",
          scrollbarColor: "var(--color-border-strong) transparent",
          scrollbarWidth: "thin",
        }}
      >
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-surface-2/40 text-[8px] uppercase text-muted-2">
              <th className="px-1.5 py-2 font-semibold">Pair</th>
              <th className="px-1.5 py-2 font-semibold">Volume 24H</th>
              <th className="px-1.5 py-2 font-semibold">Status</th>
              <th className="px-1.5 py-2 text-right font-semibold">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((hit) => (
              <ZoneRow key={hit.symbol} hit={hit} color={color} maxVol={maxVol} onSelect={onSelect} />
            ))}
          </tbody>
        </table>

        {hiddenCount > 0 && (
          <LockedOverlay feature="scannerExtended" className="border-t border-border">
            <div className="flex h-24 items-center justify-center text-xs text-muted-2">
              {hiddenCount} setup tambahan
            </div>
          </LockedOverlay>
        )}

        {total === 0 && (
          <p className="px-3 py-5 text-center text-[11px] text-muted-2">
            Belum ada zona dengan confidence di atas {MIN_DASHBOARD_CONFIDENCE}%.
          </p>
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => router.push("/patterns")}
          className="mt-3 inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-surface-3 px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:text-foreground"
        >
          Lihat semua ({total})
        </button>
      )}
    </section>
  );
}

export function SupplyDemandSection({
  onSelect,
}: {
  onSelect?: (symbol: string, timeframe: Timeframe) => void;
}) {
  const { result, loading, error, refresh } = useSdScan();

  // Rows and totals both arrive already filtered by the API. A free plan is
  // sent only the first three, so the totals are what tells the locked overlay
  // how many rows are being withheld.

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-surface p-3 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-bold">
            <Layers className="size-4.5 text-accent-2" />
            Signals
          </h2>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent-blue px-3.5 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {loading ? "Scanning…" : "Scan Semua"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-[12px] text-warning">
          {error}
        </div>
      )}


      {loading && !result && (
        <div className="flex h-48 items-center justify-center text-muted-2">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}

      {result && (
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <ZoneCard
            title="Demand Zones (Buy)"
            hits={result.demand}
            totalCount={result.demandTotal}
            tone="green"
            onSelect={onSelect}
          />
          <ZoneCard
            title="Supply Zones (Sell)"
            hits={result.supply}
            totalCount={result.supplyTotal}
            tone="red"
            onSelect={onSelect}
          />
        </div>
      )}
    </section>
  );
}

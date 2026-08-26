"use client";

import Link from "next/link";
import {
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useSdScan } from "@/presentation/hooks/use-scanner";
import type { SdScanHit } from "@/core/application/scanner/supply-demand-scan-service";
import { Badge } from "@/presentation/ui/badge";
import { CoinIcon } from "@/presentation/ui/coin-icon";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { formatCompact } from "@/shared/lib/format";

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

function ZoneTable({ title, hits, tone }: { title: string; hits: SdScanHit[]; tone: "green" | "red" }) {
  const color = tone === "green" ? "var(--color-positive)" : "var(--color-negative)";
  const Icon = tone === "green" ? TrendingUp : TrendingDown;
  const maxVol = Math.max(1, ...hits.map((h) => h.volume24h));
  // Defensive: a Demand (Buy) table only ever shows long setups and a Supply
  // (Sell) table only ever shows short setups — never mix directions.
  const filtered = hits.filter((h) => (tone === "green" ? h.direction === "long" : h.direction === "short"));

  return (
    <section className="card relative flex flex-col overflow-hidden">
      {/* top accent glow */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-48 w-3/4 -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: color }}
      />
      <div className="relative flex items-center justify-between gap-3 border-b border-border bg-surface-2/60 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-8 items-center justify-center rounded-lg shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${color}22, ${color}08)`,
              border: `1px solid ${color}44`,
              color,
            }}
          >
            <Icon className="size-4" />
          </span>
          <div>
            <h3 className="text-[14px] font-bold tracking-tight">{title}</h3>
            <p className="text-[10px] text-muted-2">
              {filtered.length} setup aktif
            </p>
          </div>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-bold tabular-nums"
          style={{ background: `${color}1a`, color, border: `1px solid ${color}44` }}
        >
          {filtered.length}
        </span>
      </div>

      <div className="relative overflow-hidden">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-surface-2/40 text-[8px] uppercase text-muted-2">
              <th className="px-1.5 py-2 font-semibold">Pair</th>
              <th className="px-1.5 py-2 font-semibold">Volume 24H</th>
              <th className="px-1.5 py-2 font-semibold">Status</th>
              <th className="px-1.5 py-2 text-right font-semibold">Confidence</th>
              <th className="px-1.5 py-2"><span className="sr-only">Watchlist</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((hit) => {
              return (
                <tr
                  key={hit.symbol}
                  className="group border-b border-border/50 transition-colors last:border-b-0 hover:bg-surface-2/60"
                >
                  <td className="px-1.5 py-2">
                    <Link href={`/analysis?symbol=${hit.symbol}`} className="flex items-center gap-1.5">
                      <CoinIcon symbol={hit.symbol} size={24} />
                      <span>
                        <span className="block text-[11px] font-bold leading-tight transition-colors group-hover:text-accent-2">
                          {hit.base}
                          <span className="font-medium text-muted-2">/USDT</span>
                        </span>
                        <span className="block text-[9px] tabular-nums text-muted-2">
                          {hit.change24h >= 0 ? "+" : ""}
                          {hit.change24h.toFixed(2)}%
                        </span>
                      </span>
                    </Link>
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
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2.5 py-8 text-center text-[11px] text-muted-2">
                  Belum ada zona aktif.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PatternsView() {
  const { canAccess } = usePlan();
  const signalsEnabled = canAccess("signals");
  const { result, loading, error, refresh } = useSdScan(signalsEnabled);

  return (
    <div className="flex flex-col gap-5 p-3 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-bold">
            <Layers className="size-4.5 text-accent-2" />
            Signals
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Zona supply/demand aktif dari pemindaian pasar (timeframe 15m).
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || !signalsEnabled}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent-blue px-3.5 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {loading ? "Scanning…" : "Scan Semua"}
        </button>
      </div>

      {!signalsEnabled ? (
        <div className="card relative overflow-hidden p-10">
          <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-accent/15 blur-3xl" />
          <div className="relative flex flex-col items-center gap-3 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent-2">
              <Sparkles className="size-3" />
              Premium
            </span>
            <h3 className="text-[16px] font-bold">Signals terkunci</h3>
            <p className="max-w-sm text-[12px] leading-snug text-muted">
              Signals lengkap tersedia pada paket Premium.
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-2">
              <Lock className="size-3.5" />
              Upgrade melalui halaman Akun & Billing.
            </p>
          </div>
        </div>
      ) : null}

      {signalsEnabled && error && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-[12px] text-warning">
          {error}
        </div>
      )}


      {signalsEnabled && loading && !result && (
        <div className="flex h-64 items-center justify-center text-muted-2">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}

      {signalsEnabled && result && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <ZoneTable title="Demand Zones (Buy)" hits={result.demand} tone="green" />
          <ZoneTable title="Supply Zones (Sell)" hits={result.supply} tone="red" />
        </div>
      )}
    </div>
  );
}

"use client";

import { useScanner } from "@/presentation/hooks/use-scanner";
import { Badge } from "@/presentation/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { formatPrice } from "@/shared/lib/format";

export function ScannerModule() {
  const { opportunities, loading, error, lastRun, refresh } = useScanner();

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Scanner Log</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Hasil scan pola terkini dari seluruh papan.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent-blue px-3.5 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {loading ? "Scanning…" : "Scan Sekarang"}
        </button>
      </div>

      {lastRun && (
        <p className="text-[11px] text-muted-2">
          Terakhir discan: {new Date(lastRun).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-[12px] text-negative">
          {error}
        </div>
      )}

      <div className="card divide-y divide-border/60 overflow-hidden">
        {loading && opportunities.length === 0 && (
          <div className="flex h-40 items-center justify-center text-muted-2">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {!loading && opportunities.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] text-muted-2">
            Belum ada hasil scan.
          </div>
        )}
        {opportunities.map((o) => (
          <div key={o.pair.symbol} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className="w-8 text-[11px] font-semibold tabular-nums text-muted-2">#{o.rank}</span>
            <span className="w-24 text-[13px] font-bold">{o.pair.symbol}</span>
            <span className="w-40 truncate text-[12px] text-foreground">{o.pattern}</span>
            <Badge tone={o.setup === "long" ? "positive" : "negative"} className="uppercase">
              {o.setup}
            </Badge>
            <span className="flex-1" />
            <span className="hidden text-[11px] text-muted-2 md:inline">
              ${formatPrice(o.pair.price)}
            </span>
            <span
              className={`hidden text-[11px] font-semibold tabular-nums md:inline ${
                o.pair.change24h >= 0 ? "text-positive" : "text-negative"
              }`}
            >
              {o.pair.change24h >= 0 ? "+" : ""}
              {o.pair.change24h.toFixed(2)}%
            </span>
            <span className="w-16 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums text-accent-2">
              {o.confidence}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

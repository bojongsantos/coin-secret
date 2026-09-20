"use client";

import { CandlestickChart, Loader2 } from "lucide-react";
import type { TopSetup } from "@/core/application/scanner/supply-demand-scan-service";
import type { Timeframe } from "@/core/domain/models";
import { useT } from "@/presentation/hooks/use-translate";
import { CoinIcon } from "@/presentation/ui/coin-icon";
import { formatPrice, priceDecimals } from "@/shared/lib/format";

/**
 * The day's best setups, as a row of chips.
 *
 * Scrolls sideways rather than wrapping: the ranking is the point, and a grid
 * that reflows puts the fourth-best under the first where it reads as a new
 * group rather than as fourth.
 */
export function TopSetupsStrip({
  setups,
  loading,
  activeSymbol,
  onSelect,
}: {
  setups: TopSetup[];
  loading: boolean;
  activeSymbol: string | null;
  onSelect: (symbol: string, timeframe: Timeframe) => void;
}) {
  const { t } = useT();

  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight sm:text-[24px]">
        <CandlestickChart className="size-6 text-accent-blue" />
        {t("dashboard.topSetups")}
      </h2>

      {loading && setups.length === 0 ? (
        <div className="mt-5 flex h-20 items-center justify-center text-muted-2">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : setups.length === 0 ? (
        <p className="mt-5 py-6 text-center text-[12px] text-muted-2">{t("dashboard.noSetups")}</p>
      ) : (
        <div className="scrollbar-thin -mx-1 mt-6 flex gap-3 overflow-x-auto px-1 pb-2">
          {setups.map((entry) => {
            const hit = entry.hit;
            const up = hit.direction === "long";
            const active = hit.symbol === activeSymbol;
            return (
              <button
                key={`${hit.symbol}-${hit.timeframe}`}
                type="button"
                onClick={() => onSelect(hit.symbol, hit.timeframe)}
                className={`group flex w-[190px] shrink-0 items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 focus-visible:-translate-y-0.5 ${
                  active
                    ? "border-accent-blue/70 bg-accent-blue/10 shadow-[0_8px_24px_rgb(77_117_255_/_12%)]"
                    : "border-border bg-surface hover:border-border-strong hover:bg-surface-2"
                }`}
              >
                <CoinIcon symbol={hit.symbol} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold leading-tight">{hit.base}</span>
                  <span className="mt-1.5 block truncate text-[11px] tabular-nums text-muted-2">
                    ${formatPrice(hit.entry, priceDecimals(hit.entry))}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  <span
                    className={`rounded px-1.5 py-px text-[9px] font-bold uppercase leading-[14px] ${
                      up
                        ? "bg-positive/15 text-positive"
                        : "bg-negative/15 text-negative"
                    }`}
                  >
                    {t(up ? "direction.long" : "direction.short")}
                  </span>
                  <span className="text-[15px] font-bold tabular-nums text-positive transition-transform duration-200 group-hover:scale-105">
                    {Math.round(hit.confidence)}%
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

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
      <h2 className="flex items-center gap-2.5 text-[20px] font-bold tracking-tight sm:text-[22px]">
        <CandlestickChart className="size-5 text-accent-blue" />
        {t("dashboard.topSetups")}
      </h2>

      {loading && setups.length === 0 ? (
        <div className="mt-5 flex h-20 items-center justify-center text-muted-2">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : setups.length === 0 ? (
        <p className="mt-5 py-6 text-center text-[12px] text-muted-2">{t("dashboard.noSetups")}</p>
      ) : (
        <div className="scrollbar-thin -mx-1 mt-5 flex gap-3 overflow-x-auto px-1 pb-2">
          {setups.map((entry) => {
            const hit = entry.hit;
            const up = hit.direction === "long";
            const active = hit.symbol === activeSymbol;
            return (
              <button
                key={`${hit.symbol}-${hit.timeframe}`}
                type="button"
                onClick={() => onSelect(hit.symbol, hit.timeframe)}
                className={`flex w-[168px] shrink-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left transition-colors ${
                  active
                    ? "border-accent-blue/60 bg-accent-blue/10"
                    : "border-border bg-surface hover:border-border-strong hover:bg-surface-2"
                }`}
              >
                <CoinIcon symbol={hit.symbol} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-bold leading-tight">{hit.base}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase leading-[14px] ${
                        up
                          ? "bg-positive/15 text-positive"
                          : "bg-negative/15 text-negative"
                      }`}
                    >
                      {t(up ? "direction.long" : "direction.short")}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[10.5px] tabular-nums text-muted-2">
                    ${formatPrice(hit.entry, priceDecimals(hit.entry))}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-bold tabular-nums text-positive">
                  {Math.round(hit.confidence)}%
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

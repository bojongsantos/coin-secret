"use client";

import Image from "next/image";
import { Scale } from "lucide-react";
import type { PatternSummary, TradeLevel } from "@/core/domain/models";
import { formatPercent, formatPrice } from "@/shared/lib/format";
import { Badge } from "@/presentation/ui/badge";
import { LockedOverlay } from "@/presentation/ui/locked-overlay";
import { useT, type Translate } from "@/presentation/hooks/use-translate";
import { domainMessageKey, statusMessageKey } from "@/shared/i18n/messages";

interface PatternCardProps {
  pattern: PatternSummary;
  levels: TradeLevel[];
  riskReward: number;
  precision: number;
}

/** A level's own name, translated when this table knows it. */
function levelLabel(t: Translate, label: string): string {
  const key = domainMessageKey("level", label);
  return key ? t(key) : label;
}

export function PatternCard({ pattern, levels, riskReward, precision }: PatternCardProps) {
  const { t } = useT();
  const bullish = pattern.trend === "bullish";
  const finished =
    pattern.status === "Invalidated (SL hit)" || pattern.status === "Target 2 reached";

  // The engine names patterns, trends and risk in stable English so the rest
  // of the system can compare them. They are turned into the reader's language
  // here and nowhere else.
  const nameKey = domainMessageKey("pattern", pattern.name);
  const statusKey = statusMessageKey(pattern.status);
  const trendKey = domainMessageKey("trend", pattern.trend);
  const riskKey = domainMessageKey("risk", pattern.riskLevel);

  return (
    <section className="cs-card flex min-w-0 flex-col p-4 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/15">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold">{t("plan.tradingPlan")}</h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${
            finished
              ? "border-negative/30 bg-negative/10 text-negative"
              : "border-positive/30 bg-positive/10 text-positive"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${finished ? "bg-negative" : "bg-positive"}`}
            aria-hidden
          />
          {statusKey ? t(statusKey) : pattern.status}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <span className="text-[22px] font-bold leading-none tracking-tight">
          {nameKey ? t(nameKey) : pattern.name}
        </span>
        {pattern.trend !== "neutral" && (
          <Badge tone={bullish ? "positive" : "negative"}>
            <Image src={`/icons/status/${bullish ? "bullish" : "bearish"}.png`} alt="" width={14} height={14} className="size-3.5 object-contain" unoptimized />
            {trendKey ? t(trendKey) : pattern.trend}
          </Badge>
        )}
      </div>

      {/* Confidence and risk side by side, as two readings of the same plan. */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium text-muted-2">{t("plan.confidence")}</p>
            <span className="text-[13px] font-bold text-accent-blue">{pattern.confidence}%</span>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent-blue to-accent"
              style={{ width: `${Math.min(100, Math.max(0, pattern.confidence))}%` }}
            />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-[11px] font-medium text-muted-2">{t("plan.riskLevel")}</p>
          <p className="mt-1.5 text-[17px] font-bold capitalize leading-none">
            {riskKey ? t(riskKey) : pattern.riskLevel}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2.5 flex items-center gap-1.5">
          <Scale className="size-3.5 text-muted-2" />
          <span className="text-[11.5px] font-semibold text-muted">{t("plan.breakdown")}</span>
        </div>

        <LockedOverlay feature="entryBreakdown">
          <ul className="space-y-1.5">
            {levels.map((level) => {
              const positive = level.changeFromPrice > 0;
              const isStop = level.id === "sl";
              return (
                <li
                  key={level.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5"
                >
                  <span className="text-[12.5px] font-medium text-muted">
                    {levelLabel(t, level.label)}
                  </span>
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`text-[11px] font-medium tabular-nums ${
                        isStop ? "text-negative" : positive ? "text-positive" : "text-muted-2"
                      }`}
                    >
                      {level.changeFromPrice === 0 ? "" : formatPercent(level.changeFromPrice)}
                    </span>
                    <span
                      className={`text-[13px] font-bold tabular-nums ${
                        isStop ? "text-negative" : positive ? "text-positive" : "text-foreground"
                      }`}
                    >
                      ${formatPrice(level.price, precision)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="mt-1.5 flex items-center justify-between rounded-xl border border-accent-blue/30 bg-gradient-to-r from-accent-blue/15 to-accent/15 px-3.5 py-2.5">
            <span className="text-[12.5px] font-medium text-foreground">{t("plan.riskReward")}</span>
            <span className="text-[14px] font-bold tabular-nums">1 : {riskReward.toFixed(0)}</span>
          </div>
        </LockedOverlay>
      </div>
    </section>
  );
}

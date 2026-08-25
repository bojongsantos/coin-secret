"use client";

import { Scale, TrendingDown, TrendingUp } from "lucide-react";
import type { PatternSummary, TradeLevel } from "@/core/domain/models";
import { formatPercent, formatPrice } from "@/shared/lib/format";
import { ProgressBar } from "@/presentation/ui/progress-bar";
import { Badge } from "@/presentation/ui/badge";
import { LockedOverlay } from "@/presentation/ui/locked-overlay";

interface PatternCardProps {
  pattern: PatternSummary;
  levels: TradeLevel[];
  riskReward: number;
  precision: number;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-2">{label}</p>
      <p className="mt-0.5 text-[15px] font-bold leading-none">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-muted">{sub}</p>}
    </div>
  );
}

export function PatternCard({ pattern, levels, riskReward, precision }: PatternCardProps) {
  const bullish = pattern.trend === "bullish";
  const TrendIcon = bullish ? TrendingUp : TrendingDown;
  const statusInvalid = pattern.status === "Invalidated (SL hit)" || pattern.status === "Target 2 reached";
  return (
    <section className="card flex flex-col p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Trading Plan</h3>
        <Badge tone={statusInvalid ? "negative" : "positive"}>{pattern.status}</Badge>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xl font-bold tracking-tight">
          <span className="gradient-text">{pattern.name}</span>
        </span>
        {pattern.trend !== "neutral" && (
          <Badge tone={bullish ? "positive" : "negative"}>
            <TrendIcon className="size-3" />
            {pattern.trend}
          </Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-surface-2 p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-2">Confidence</p>
            <span className="text-xs font-bold text-accent-2">{pattern.confidence}%</span>
          </div>
          <ProgressBar value={pattern.confidence} className="mt-1.5" />
        </div>
        <Stat label="Risk Level" value={pattern.riskLevel} />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Scale className="size-3.5 text-muted-2" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Trade Breakdown</span>
        </div>
        <LockedOverlay feature="entryBreakdown">
          <ul className="space-y-1.5">
            {levels.map((level) => {
              const positive = level.changeFromPrice > 0;
              const isSl = level.id === "sl";
              return (
                <li
                  key={level.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-muted">{level.label}</span>
                    {level.filled && (
                      <Badge tone="positive" className="text-[9px]">
                        Filled
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`text-[12px] font-semibold tabular-nums ${
                        isSl ? "text-negative" : positive ? "text-positive" : "text-foreground"
                      }`}
                    >
                      ${formatPrice(level.price, precision)}
                    </span>
                    <span
                      className={`w-16 text-right text-[11px] font-medium tabular-nums ${
                        isSl ? "text-negative" : positive ? "text-positive" : "text-muted-2"
                      }`}
                    >
                      {level.changeFromPrice === 0 ? "—" : formatPercent(level.changeFromPrice)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 flex items-center justify-between rounded-lg bg-gradient-to-r from-accent/15 to-accent-blue/15 px-3 py-2">
            <span className="text-[12px] font-medium text-muted">Risk-Reward Ratio</span>
            <span className="text-[13px] font-bold tabular-nums text-foreground">1 : {riskReward.toFixed(0)}</span>
          </div>
        </LockedOverlay>
      </div>

    </section>
  );
}

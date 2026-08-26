import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { ScannerOpportunity } from "@/core/domain/models";
import { Sparkline } from "@/presentation/ui/sparkline";
import { Badge } from "@/presentation/ui/badge";
import { formatPrice } from "@/shared/lib/format";

interface OpportunityCardProps {
  data: ScannerOpportunity;
}

export function OpportunityCard({ data }: OpportunityCardProps) {
  const long = data.setup === "long";
  const trendUp = long;
  const TrendIcon = trendUp ? TrendingUp : TrendingDown;
  const trendColor = trendUp ? "var(--color-positive)" : "var(--color-negative)";

  return (
    <Link
      href={`/analysis?symbol=${data.pair.symbol}`}
      className="card flex w-[290px] shrink-0 flex-col gap-3 p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between">
        <span className="flex size-6 items-center justify-center rounded-md bg-surface-3 text-[11px] font-bold text-muted-2">
          {data.rank}
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-bold tabular-nums text-accent-2">
          {data.confidence}%
        </span>
      </div>

      <div>
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-bold">{data.pair.base}</span>
          <TrendIcon className="size-4" style={{ color: trendColor }} />
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          <span className="text-muted-2">${formatPrice(data.pair.price)}</span>
          <span className={data.pair.change24h >= 0 ? "text-positive" : "text-negative"}>
            {data.pair.change24h >= 0 ? "+" : ""}
            {data.pair.change24h.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-foreground">{data.pattern}</span>
        <Badge tone={long ? "positive" : "negative"} className="uppercase">
          {data.setup} Setup
        </Badge>
      </div>

      {data.status && (
        <div className="-mt-1">
          <Badge tone={data.status === "Running" || data.status === "Target 1 reached" || data.status === "Target 2 reached" ? "positive" : data.status === "Filled" ? "blue" : data.status === "Limit Order" ? "warning" : "neutral"} className="text-[10px]">
            {data.status}
          </Badge>
        </div>
      )}

      <div className="-mx-1">
        <Sparkline data={data.sparkline} width={258} height={36} stroke={trendColor} />
      </div>
    </Link>
  );
}

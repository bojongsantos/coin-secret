"use client";

import type { SentimentData } from "@/core/domain/models";
import { Gauge } from "@/presentation/ui/gauge";
import { useT } from "@/presentation/hooks/use-translate";

const zoneColors: Record<string, string> = {
  "Extreme Fear": "var(--color-negative)",
  Fear: "var(--color-warning)",
  Neutral: "var(--color-muted-2)",
  Greed: "#84cc16",
  "Extreme Greed": "var(--color-positive)",
};

export function MarketSentimentCard({ data }: { data: SentimentData }) {
  const { t } = useT();
  if (data.available === false) {
    return (
      <section className="cs-card p-4">
        <h3 className="text-[13px] font-semibold">{t("rail.marketSentiment")}</h3>
        <p className="mt-4 rounded-lg border border-border bg-surface-2 px-3 py-5 text-center text-[11px] text-muted-2">
          {t("rail.sentimentUnavailable")}
        </p>
      </section>
    );
  }

  return (
    <section className="cs-card p-4">
      <h3 className="text-[13px] font-semibold">{t("rail.marketSentiment")}</h3>

      <div className="mt-2 flex justify-center">
        <Gauge score={data.score} label={data.label} />
      </div>

      <div className="mt-3">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full">
          {data.distribution.map((zone) => (
            <div
              key={zone.label}
              style={{ width: `${zone.value}%`, backgroundColor: zoneColors[zone.label] }}
              className="h-full first:rounded-l-full last:rounded-r-full"
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1">
          {data.distribution.map((zone) => (
            <span key={zone.label} className="inline-flex items-center gap-1 text-[10px] text-muted-2">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: zoneColors[zone.label] }} />
              {zone.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

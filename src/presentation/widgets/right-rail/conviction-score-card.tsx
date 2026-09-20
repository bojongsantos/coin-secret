"use client";

import { Info } from "lucide-react";
import type { ConvictionScore } from "@/core/domain/analysis/conviction";
import { LockedOverlay } from "@/presentation/ui/locked-overlay";
import { Tooltip } from "@/presentation/ui/tooltip";
import { ConvictionRing } from "@/presentation/widgets/right-rail/conviction-ring";
import { useT, type Translate } from "@/presentation/hooks/use-translate";
import { domainMessageKey } from "@/shared/i18n/messages";

/** The name of a contribution, in the reader's language. */
function labelFor(t: Translate, id: string): string | undefined {
  const key = domainMessageKey(
    "conviction",
    { quality: "zoneQuality", freshness: "zoneFreshness", touches: "touchPenalty", base: "baseScore" }[id] ?? id,
  );
  return key ? t(key) : undefined;
}

/** What each contribution to the score is measuring. */
function tooltipFor(t: Translate, id: string): string | undefined {
  const key = domainMessageKey("conviction", id);
  return key ? t(key) : undefined;
}

/** Stable component colors mirror the supplied confidence-score legend. */
function dotColor(id: string): string {
  return {
    quality: "var(--color-negative)",
    freshness: "var(--color-warning)",
    touches: "var(--color-positive)",
    base: "var(--color-accent-blue)",
  }[id] ?? "var(--color-muted-2)";
}

export function ConvictionScoreCard({ data }: { data: ConvictionScore }) {
  const { t } = useT();
  const waiting = data.score === 0 && data.grade === "F";

  return (
    <section className="cs-card @container p-5">
      <h3 className="text-[16px] font-semibold">{t("rail.confidenceScore")}</h3>

      {/* Ring beside its parts, not above them: the four contributions are a
          reading of the number, and side by side they are read as one thing. */}
      <div className="mt-6 flex flex-col items-center gap-6 @[390px]:flex-row @[390px]:justify-between @[390px]:gap-6">
        <div className="shrink-0">
          {waiting ? (
            <span className="block w-32 py-10 text-center text-[13px] font-semibold text-muted-2">
              {t("rail.waitingForData")}
            </span>
          ) : (
            <ConvictionRing score={data.score} />
          )}
        </div>

        <LockedOverlay feature="convictionDetail" className="w-full min-w-[164px] flex-1">
          <ul className="space-y-4">
            {data.components.map((comp) => (
              <li key={comp.id} className="flex items-center gap-3">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: dotColor(comp.id) }}
                />
                <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-foreground">
                  {labelFor(t, comp.id) ?? comp.label}
                </span>
                <Tooltip content={tooltipFor(t, comp.id) ?? comp.detail}>
                  <Info className="size-4 shrink-0 text-muted-2 transition-colors hover:text-muted" />
                </Tooltip>
              </li>
            ))}
          </ul>
        </LockedOverlay>
      </div>
    </section>
  );
}

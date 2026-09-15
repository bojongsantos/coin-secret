"use client";

import { Info } from "lucide-react";
import type { ConvictionScore } from "@/core/domain/analysis/conviction";
import { LockedOverlay } from "@/presentation/ui/locked-overlay";
import { Tooltip } from "@/presentation/ui/tooltip";
import { ConvictionRing } from "@/presentation/widgets/right-rail/conviction-ring";
import { useT, type Translate } from "@/presentation/hooks/use-translate";
import { domainMessageKey, type MessageKey } from "@/shared/i18n/messages";

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

/** Status dot color from normalized quality (0..1). */
function dotColor(ratio: number): string {
  if (ratio >= 0.7) return "var(--color-positive)";
  if (ratio >= 0.3) return "var(--color-warning)";
  return "var(--color-negative)";
}

export function ConvictionScoreCard({ data }: { data: ConvictionScore }) {
  const { t } = useT();
  const waiting = data.score === 0 && data.grade === "F";

  return (
    <section className="card p-4">
      <h3 className="text-center text-[13px] font-semibold">{t("rail.confidenceScore")}</h3>

      <div className="mt-4 flex flex-col items-center">
        {waiting ? (
          <span className="py-10 text-lg font-semibold text-muted-2">{t("rail.waitingForData")}</span>
        ) : (
          <ConvictionRing score={data.score} grade={data.grade} />
        )}
      </div>

      {!waiting && (
        <p className="mt-5 text-center text-[12px] leading-snug text-muted">
          {t(`grade.${data.grade}` as MessageKey)}
        </p>
      )}

      <LockedOverlay feature="convictionDetail" className="mt-3">
        <ul className="space-y-2.5">
          {data.components.map((comp) => (
            <li key={comp.id} className="flex items-center gap-2.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: dotColor(comp.ratio) }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                {labelFor(t, comp.id) ?? comp.label}
              </span>
              <Tooltip content={tooltipFor(t, comp.id) ?? comp.detail}>
                <Info className="size-3.5 text-muted-2 transition-colors hover:text-muted" />
              </Tooltip>
            </li>
          ))}
        </ul>
      </LockedOverlay>
    </section>
  );
}

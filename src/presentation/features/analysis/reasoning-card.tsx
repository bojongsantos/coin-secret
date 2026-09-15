"use client";

import { CheckCircle2 } from "lucide-react";
import type { ReasoningSection } from "@/core/domain/models";
import { useT } from "@/presentation/hooks/use-translate";

function renderPoint(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-foreground">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

function SectionCard({ section }: { section: ReasoningSection }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-[13.5px] font-bold">{section.title}</p>
      <ul className="mt-4 space-y-2.5">
        {section.points.map((point, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" />
            <span className="min-w-0">{renderPoint(point)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The reasoning, in the design's three tracks.
 *
 * Risk management runs to seven or eight lines while the others run to two or
 * three, so it takes a column of its own and the short blocks stack in the
 * other two. Stacked in one column it pushed everything else a screen down.
 */
export function ReasoningCard({ sections }: { sections: ReasoningSection[] }) {
  const { t } = useT();
  const risk = sections.find((section) => section.id === "risk");
  const rest = sections.filter((section) => section.id !== "risk");
  const left = rest.filter((_, index) => index % 2 === 0);
  const right = rest.filter((_, index) => index % 2 === 1);

  return (
    <section>
      <h2 className="text-[20px] font-bold tracking-tight sm:text-[22px]">{t("plan.reasoning")}</h2>

      <div className="mt-5 grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4">
          {left.map((section) => (
            <SectionCard key={section.id} section={section} />
          ))}
        </div>
        <div className="space-y-4">
          {right.map((section) => (
            <SectionCard key={section.id} section={section} />
          ))}
        </div>
        <div>{risk && <SectionCard section={risk} />}</div>
      </div>
    </section>
  );
}

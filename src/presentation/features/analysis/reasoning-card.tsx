"use client";

import { CheckCircle2 } from "lucide-react";
import type { ReasoningSection } from "@/core/domain/models";
import { useT } from "@/presentation/hooks/use-translate";

function renderPoint(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

function SectionCard({ section, prominent = false }: { section: ReasoningSection; prominent?: boolean }) {
  return (
    <div className={`cs-card h-full transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/15 ${prominent ? "p-5" : "p-4"}`}>
      <p className={`${prominent ? "text-[15px]" : "text-[13.5px]"} font-bold`}>{section.title}</p>
      <ul className={`${prominent ? "mt-5 space-y-3" : "mt-4 space-y-2.5"}`}>
        {section.points.map((point, i) => (
          <li key={i} className={`flex items-start gap-2.5 leading-relaxed text-muted ${prominent ? "text-[13.5px]" : "text-[12.5px]"}`}>
            <CheckCircle2 className={`${prominent ? "size-[18px]" : "size-4"} mt-0.5 shrink-0 text-positive`} />
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
export function ReasoningCard({ sections, prominent = false }: { sections: ReasoningSection[]; prominent?: boolean }) {
  const { t } = useT();
  const risk = sections.find((section) => section.id === "risk");
  const rest = sections.filter((section) => section.id !== "risk");
  const leftIds = new Set(["summary", "momentum"]);
  const rightIds = new Set(["structure", "levels"]);
  const left = rest.filter((section) => leftIds.has(section.id));
  const right = rest.filter((section) => rightIds.has(section.id));
  left.push(...rest.filter((section) => !leftIds.has(section.id) && !rightIds.has(section.id)));

  return (
    <section>
      <h2 className={`${prominent ? "text-[22px] sm:text-[24px]" : "text-[20px] sm:text-[22px]"} font-bold tracking-tight`}>{t("plan.reasoning")}</h2>

      <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_1fr_1.75fr] [&>*]:min-w-0">
        <div className="grid gap-3">
          {left.map((section) => (
            <SectionCard key={section.id} section={section} prominent={prominent} />
          ))}
        </div>
        <div className="grid gap-3">
          {right.map((section) => (
            <SectionCard key={section.id} section={section} prominent={prominent} />
          ))}
        </div>
        <div>{risk && <SectionCard section={risk} prominent={prominent} />}</div>
      </div>
    </section>
  );
}

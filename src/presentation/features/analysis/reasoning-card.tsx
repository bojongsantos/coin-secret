import { CheckCircle2, ChartNoAxesCombined } from "lucide-react";
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

function SectionBlock({ section }: { section: ReasoningSection }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-2">{section.title}</p>
      <ul className="mt-1.5 space-y-1.5">
        {section.points.map((point, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-positive" />
            <span>{renderPoint(point)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReasoningCard({ sections }: { sections: ReasoningSection[] }) {
  const { t } = useT();
  return (
    <section className="card flex flex-col p-4">
      <div className="flex items-center gap-1.5">
        <ChartNoAxesCombined className="size-4 text-accent-2" />
        <h3 className="text-[13px] font-semibold">{t("plan.reasoning")}</h3>
      </div>

      <div className="mt-3 flex-1 space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            {sections.slice(0, 2).map((section) => (
              <SectionBlock key={section.id} section={section} />
            ))}
          </div>
          <div className="space-y-4">
            {sections.slice(2, 4).map((section) => (
              <SectionBlock key={section.id} section={section} />
            ))}
          </div>
        </div>
        {sections.slice(4).map((section) => (
          <SectionBlock key={section.id} section={section} />
        ))}
      </div>
    </section>
  );
}

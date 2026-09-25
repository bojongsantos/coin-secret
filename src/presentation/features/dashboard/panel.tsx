"use client";

import type { ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useT } from "@/presentation/hooks/use-translate";

/**
 * A heading in the design's two tones: the first word carries the weight and
 * the rest recedes. Written as one string in the message table and split here,
 * so a translator never has to know about the seam.
 */
function TwoTone({ text }: { text: string }) {
  const space = text.indexOf(" ");
  if (space < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, space)}
      <span className="font-semibold text-muted"> {text.slice(space + 1)}</span>
    </>
  );
}

/**
 * The outer container every dashboard block sits in.
 *
 * One component rather than the same six classes written out per block: the
 * blocks are meant to read as one stack, and a rounding or padding that drifts
 * on one of them is the kind of thing nobody notices in review and everybody
 * notices on the page.
 */
export function Panel({
  title,
  icon,
  onRefresh,
  refreshing,
  children,
}: {
  title: string;
  icon?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <section className="cs-panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-[20px] font-bold tracking-tight sm:text-[22px]">
          {icon}
          <TwoTone text={title} />
        </h2>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="cs-primary inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {t("common.refresh")}
          </button>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A card inside a panel. */
export function PanelCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`cs-card p-4 sm:p-5 ${className}`}>{children}</div>
  );
}

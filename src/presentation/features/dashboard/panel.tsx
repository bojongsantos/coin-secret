"use client";

import type { ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useT } from "@/presentation/hooks/use-translate";

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
    <section className="rounded-3xl border border-border bg-surface/40 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-[20px] font-bold tracking-tight sm:text-[22px]">
          {icon}
          {title}
        </h2>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-accent-blue to-accent px-4 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {t("common.refresh")}
          </button>
        )}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A card inside a panel. */
export function PanelCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-surface p-4 sm:p-5 ${className}`}>{children}</div>
  );
}

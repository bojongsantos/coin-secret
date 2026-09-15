"use client";

import { useT } from "@/presentation/hooks/use-translate";

/**
 * A placeholder where a sponsored banner will go.
 *
 * Deliberately filler text rather than invented headlines. This is a trading
 * product, and a plausible-looking crypto headline sitting between a sentiment
 * gauge and a live signals board reads as market information; someone could act
 * on a sentence that was never true. A slot that looks like a slot cannot be
 * mistaken for one.
 */
export function AdSlot({ index }: { index: number }) {
  const { t } = useT();
  return (
    <div className="relative flex min-h-[132px] items-center overflow-hidden rounded-2xl border border-dashed border-border bg-surface/60 px-5 py-6 sm:px-7">
      <span className="absolute right-4 top-4 rounded-full border border-border bg-surface-3 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-2">
        {t("ads.label")}
      </span>
      <div className="min-w-0 max-w-lg">
        <p className="text-[14px] font-bold text-muted">
          {t("ads.placeholderTitle", { index })}
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-2">{t("ads.placeholderBody")}</p>
      </div>
    </div>
  );
}

/** The pair of slots the design puts between the board and the top setups. */
export function AdRow() {
  return (
    <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
      <AdSlot index={1} />
      <AdSlot index={2} />
    </div>
  );
}

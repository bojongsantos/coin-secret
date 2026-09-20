"use client";

import { Info, ShieldAlert } from "lucide-react";
import type { MarketContext } from "@/core/domain/models";
import { Delta } from "@/presentation/ui/delta";
import { Tooltip } from "@/presentation/ui/tooltip";
import { CoinIcon } from "@/presentation/ui/coin-icon";
import { useT, type Translate } from "@/presentation/hooks/use-translate";
import { domainMessageKey } from "@/shared/i18n/messages";

/**
 * What each row is measuring, in the reader's language.
 *
 * The labels are the industry's own terms and say nothing to a reader who has
 * not traded perpetuals. Looked up here rather than shipped in the payload
 * because it is wording, not data: the server has no business sending a
 * paragraph of prose alongside a number, in either language.
 */
function metricHelp(t: Translate, id: string): string | undefined {
  const key = domainMessageKey("metric", id);
  return key ? t(key) : undefined;
}

function MetricRow({
  label,
  value,
  direction,
  change,
  hint,
  tone,
  warning,
  hideDelta,
  help,
  t,
}: {
  label: string;
  value: string;
  direction: "up" | "down" | "flat";
  change: number;
  hint?: string;
  tone?: "positive" | "negative";
  warning?: boolean;
  hideDelta?: boolean;
  help?: string;
  t: Translate;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <p className="shrink-0 text-[15px] font-medium text-muted">{label}</p>
        {help && (
          <Tooltip content={warning ? `${help}

${t("metric.unavailableNote")}` : help}>
            <Info className="size-4 shrink-0 text-muted-2 transition-colors hover:text-muted" />
          </Tooltip>
        )}
        {warning && !help && (
          <span title={t("metric.unavailable")} aria-label={t("metric.unavailable")}>
            <ShieldAlert className="size-3 shrink-0 text-warning" aria-hidden="true" />
          </span>
        )}
        {hint && !warning && <p className="truncate text-[12px] text-muted-2">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2.5 text-right">
        <span
          className={`text-[16px] font-semibold tabular-nums ${
            tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : ""
          }`}
        >
          {value}
        </span>
        {!hideDelta && <Delta value={change} direction={direction} />}
      </div>
    </div>
  );
}

export function MarketContextCard({ data }: { data: MarketContext }) {
  const { t } = useT();
  return (
    <section className="cs-card @container p-5">
      <h3 className="text-[16px] font-semibold">{t("rail.marketContext")}</h3>

      <div className="mt-5 grid grid-cols-1 gap-4 @[300px]:grid-cols-2">
        {[data.btc, data.eth].map((coin) => {
          return (
            <div key={coin.id} className="rounded-2xl border border-border bg-surface-2 p-4">
              <p className="truncate text-[14px] font-semibold uppercase tracking-wide text-muted-2">
                {coin.label}/USDT
              </p>
              <div className="mt-3 flex items-center gap-4">
                <CoinIcon symbol={`${coin.label}USDT`} size={48} />
                <div className="min-w-0">
                  <p className="truncate text-[27px] font-bold tabular-nums leading-none">
                    {coin.value === "—" ? coin.value : `$${coin.value}`}
                  </p>
                  <Delta value={coin.change} direction={coin.direction} className="mt-2 text-[15px]" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 divide-y divide-border/60 border-t border-border pt-1">
        <MetricRow
          label={data.fundingRate.label}
          value={data.fundingRate.value}
          direction={data.fundingRate.direction}
          change={data.fundingRate.change}
          hint={data.fundingRate.hint}
          tone={data.fundingRate.tone}
          warning={data.fundingRate.warning}
          help={metricHelp(t, data.fundingRate.id)}
          t={t}
          hideDelta={data.fundingRate.hideDelta}
        />
        <MetricRow
          label={data.openInterest.label}
          value={data.openInterest.value}
          direction={data.openInterest.direction}
          change={data.openInterest.change}
          hint={data.openInterest.hint}
          warning={data.openInterest.warning}
          help={metricHelp(t, data.openInterest.id)}
          t={t}
          hideDelta={data.openInterest.hideDelta}
        />
        <MetricRow
          label={data.dominance.label}
          value={data.dominance.value}
          direction={data.dominance.direction}
          change={data.dominance.change}
          hint={data.dominance.hint}
          warning={data.dominance.warning}
          help={metricHelp(t, data.dominance.id)}
          t={t}
        />
        <MetricRow
          label={data.volume.label}
          value={data.volume.value}
          direction={data.volume.direction}
          change={data.volume.change}
          tone={data.volume.tone}
          warning={data.volume.warning}
          help={metricHelp(t, data.volume.id)}
          t={t}
          hideDelta={data.volume.hideDelta}
        />
      </div>
    </section>
  );
}

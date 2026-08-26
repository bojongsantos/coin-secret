import { Info, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import type { MarketContext } from "@/core/domain/models";
import { Delta } from "@/presentation/ui/delta";
import { Tooltip } from "@/presentation/ui/tooltip";

/**
 * What each row is measuring.
 *
 * The labels are the industry's own terms, which say nothing to a reader who
 * has not traded perpetuals. Written here rather than in the payload because
 * it is wording, not data: the server has no business shipping a paragraph of
 * Indonesian prose alongside a number.
 */
const metricHelp: Record<string, string> = {
  dom: "Porsi kapitalisasi pasar kripto yang dipegang Bitcoin. Naik berarti dana berpindah dari altcoin ke BTC.",
  funding:
    "Biaya berkala yang dibayarkan antar pemegang posisi perpetual. Positif berarti pembeli membayar penjual — mayoritas pasar sedang long.",
  oi: "Total nilai posisi futures yang masih terbuka. Naik bersama harga menandakan tren didukung uang baru, bukan sekadar penutupan posisi.",
  fng: "Indeks sentimen pasar 0–100 dari Alternative.me. Angka rendah berarti pasar takut, angka tinggi berarti pasar serakah.",
};

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
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="text-[12px] font-medium text-muted">{label}</p>
        {help && (
          <Tooltip content={warning ? `${help}

Data sumber sedang tidak tersedia.` : help}>
            <Info className="size-3.5 shrink-0 text-muted-2 transition-colors hover:text-muted" />
          </Tooltip>
        )}
        {warning && !help && (
          <span title="Data tidak tersedia" aria-label="Data tidak tersedia">
            <ShieldAlert className="size-3 shrink-0 text-warning" aria-hidden="true" />
          </span>
        )}
        {hint && !warning && <p className="text-[10px] text-muted-2">{hint}</p>}
      </div>
      <div className="flex items-center gap-2 text-right">
        <span
          className={`text-[12px] font-semibold tabular-nums ${
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
  return (
    <section className="card p-4">
      <h3 className="text-[13px] font-semibold">Market Context</h3>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {[data.btc, data.eth].map((coin) => {
          const up = coin.direction === "up";
          const Icon = up ? TrendingUp : TrendingDown;
          return (
            <div key={coin.id} className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">{coin.label}</span>
                <Icon className={`size-4 ${up ? "text-positive" : "text-negative"}`} />
              </div>
              <p className="mt-1 text-lg font-bold tabular-nums leading-none">
                {coin.value === "—" ? coin.value : `$${coin.value}`}
              </p>
              <Delta value={coin.change} className="mt-1" />
            </div>
          );
        })}
      </div>

      <div className="mt-3 divide-y divide-border/60 border-t border-border pt-2">
        <MetricRow
          label={data.fundingRate.label}
          value={data.fundingRate.value}
          direction={data.fundingRate.direction}
          change={data.fundingRate.change}
          hint={data.fundingRate.hint}
          tone={data.fundingRate.tone}
          warning={data.fundingRate.warning}
          help={metricHelp[data.fundingRate.id]}
          hideDelta={data.fundingRate.hideDelta}
        />
        <MetricRow
          label={data.openInterest.label}
          value={data.openInterest.value}
          direction={data.openInterest.direction}
          change={data.openInterest.change}
          hint={data.openInterest.hint}
          warning={data.openInterest.warning}
          help={metricHelp[data.openInterest.id]}
          hideDelta={data.openInterest.hideDelta}
        />
        <MetricRow
          label={data.dominance.label}
          value={data.dominance.value}
          direction={data.dominance.direction}
          change={data.dominance.change}
          hint={data.dominance.hint}
          warning={data.dominance.warning}
          help={metricHelp[data.dominance.id]}
        />
        <MetricRow
          label={data.volume.label}
          value={data.volume.value}
          direction={data.volume.direction}
          change={data.volume.change}
          tone={data.volume.tone}
          warning={data.volume.warning}
          help={metricHelp[data.volume.id]}
          hideDelta={data.volume.hideDelta}
        />
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { PLAN_CAPABILITIES } from "@/core/domain/access/plan-catalog";
import {
  billingPlan,
  BILLING_PERIODS,
  formatUsd,
  savingsPercent,
  type BillingPeriod,
} from "@/core/domain/billing/plans";
import type { SubscriptionPlan } from "@/core/domain/identity";
import type { ProviderCopy } from "@/core/domain/billing/provider-copy";
import { useT, type Translate } from "@/presentation/hooks/use-translate";
import { Reveal } from "@/presentation/ui/reveal";
import { domainMessageKey, type MessageKey } from "@/shared/i18n/messages";

interface PricingModuleProps {
  authenticated: boolean;
  plan: SubscriptionPlan | null;
  periodEnd: string | null;
  provider: ProviderCopy;
}

/** A capability's qualifier, in the reader's language, or `true` for a plain yes. */
function qualifier(t: Translate, value: string | true, fallback: string): string | true {
  if (value === true) return true;
  const key = domainMessageKey("capability", value === "Terbatas" ? "limited" : "full");
  return key ? t(key) : fallback;
}

function PlanCard({
  name,
  blurb,
  price,
  note,
  rows,
  column,
  action,
  featured,
}: {
  name: string;
  blurb: string;
  price: string;
  note?: string;
  rows: Array<{ id: string; name: string; value: string | true }>;
  column: "free" | "pro";
  action: React.ReactNode;
  featured?: boolean;
}) {
  const { t } = useT();
  return (
    <section
      className={`flex flex-col rounded-2xl border p-6 ${
        featured
          ? "border-accent-blue/40 bg-gradient-to-br from-accent-blue/12 via-surface to-surface"
          : "border-border bg-surface"
      }`}
    >
      <p className="text-[13px] font-semibold text-muted">{name}</p>
      <p className="mt-3 flex items-baseline gap-1">
        <span className="text-[40px] font-bold leading-none tracking-tight">{price}</span>
        <span className="text-[14px] font-medium text-muted-2">{t("pricing.perMonth")}</span>
      </p>
      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{blurb}</p>
      {note && <p className="mt-1.5 text-[11.5px] text-muted-2">{note}</p>}

      <p className="mt-6 text-[12.5px] font-semibold">{t("pricing.included")}</p>
      <ul className="mt-3 flex-1 space-y-2.5">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-2.5 text-[12.5px] leading-snug text-muted">
            <Check
              className={`mt-0.5 size-3.5 shrink-0 ${column === "pro" ? "text-accent-blue" : "text-positive"}`}
              aria-hidden
            />
            <span>
              {row.name}
              {row.value !== true && (
                <span className="ml-1 font-semibold text-foreground">({row.value})</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-7">{action}</div>
    </section>
  );
}

export function PricingModule({ authenticated, plan, periodEnd, provider }: PricingModuleProps) {
  const { t, locale } = useT();
  const [period, setPeriod] = useState<BillingPeriod>("annual");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = billingPlan(period);
  const isPro = plan === "PREMIUM";
  const dateFormatter = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const rows = PLAN_CAPABILITIES.map((capability) => {
    const key = domainMessageKey("capability", capability.id);
    const name = key ? t(key) : capability.label;
    return {
      id: capability.id,
      name,
      free: qualifier(t, capability.free, capability.label),
      pro: qualifier(t, capability.pro, capability.label),
    };
  });

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const payload = (await response.json()) as {
        redirectUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.redirectUrl) {
        setError(payload.error?.message ?? t("pricing.checkoutFailed"));
        return;
      }
      window.location.href = payload.redirectUrl;
    } catch {
      setError(t("pricing.checkoutOffline"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-surface/40 p-4 sm:p-8">
      <Reveal as="header" stagger className="mx-auto max-w-2xl text-center">
        <h1 className="text-balance text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">
          {t("pricing.headlineA")}
          <br />
          <span className="text-muted">{t("pricing.headlineB")}</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[13px] leading-relaxed text-muted">
          {t("pricing.subhead")}
        </p>
      </Reveal>

      <div
        role="group"
        aria-label={t("pricing.periodGroup")}
        className="mx-auto mt-7 flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-surface p-1 sm:w-fit sm:flex-nowrap"
      >
        {BILLING_PERIODS.map((option) => {
          const savings = savingsPercent(option);
          const active = option === period;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => setPeriod(option)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors ${
                active ? "bg-accent-blue text-white" : "text-muted hover:text-foreground"
              }`}
            >
              {t(`pricing.period.${option}` as MessageKey)}
              {savings > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${
                    active ? "bg-white/20 text-white" : "bg-accent-blue/20 text-accent-blue"
                  }`}
                >
                  {t("pricing.savings", { percent: savings })}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Reveal stagger className="mt-7 grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <PlanCard
          name={t("common.free")}
          blurb={t("pricing.freeBlurb")}
          price="$0"
          rows={rows.map((row) => ({ id: row.id, name: row.name, value: row.free }))}
          column="free"
          action={
            authenticated ? (
              <p className="rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-center text-[12.5px] font-semibold text-muted">
                {isPro ? t("pricing.includedInPro") : t("pricing.currentPlan")}
              </p>
            ) : (
              <Link
                href="/register"
                className="block rounded-xl border border-border px-4 py-2.5 text-center text-[13px] font-bold transition-colors hover:border-border-strong"
              >
                {t("pricing.startFree")}
              </Link>
            )
          }
        />

        <PlanCard
          featured
          name={t("common.pro")}
          blurb={t("pricing.proBlurb")}
          price={formatUsd(selected.perMonthUsd)}
          note={
            selected.months === 1
              ? t("pricing.billedMonthly", { total: formatUsd(selected.totalUsd) })
              : t("pricing.billedOnce", {
                  total: formatUsd(selected.totalUsd),
                  months: selected.months,
                })
          }
          rows={rows.map((row) => ({ id: row.id, name: row.name, value: row.pro }))}
          column="pro"
          action={
            !authenticated ? (
              <Link
                href="/login?next=/pricing"
                className="block rounded-xl bg-gradient-to-r from-accent-blue to-accent px-4 py-2.5 text-center text-[13px] font-bold text-white transition-opacity hover:opacity-90"
              >
                {t("pricing.signInToSubscribe")}
              </Link>
            ) : isPro ? (
              <div className="rounded-xl border border-positive/30 bg-positive/10 px-4 py-2.5 text-center">
                <p className="text-[12.5px] font-bold text-positive">{t("pricing.proActive")}</p>
                {periodEnd && (
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    {t("pricing.activeUntil", { date: dateFormatter.format(new Date(periodEnd)) })}
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void checkout()}
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent-blue to-accent px-4 py-2.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {loading && <Loader2 className="size-4 animate-spin" />}
                {t("pricing.subscribe")}
              </button>
            )
          }
        />
      </Reveal>
      {error && <p className="mt-3 text-center text-[12px] text-negative">{error}</p>}

      <Reveal as="section" className="mt-9">
        <h2 className="text-[15px] font-semibold">{t("pricing.comparison")}</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[520px] text-left">
            <thead className="bg-accent-blue text-white">
              <tr className="text-[12px] font-semibold">
                <th scope="col" className="px-5 py-3.5">
                  {t("pricing.benefits")}
                </th>
                <th scope="col" className="w-32 px-5 py-3.5">
                  {t("common.free")}
                </th>
                <th scope="col" className="w-32 px-5 py-3.5">
                  {t("common.pro")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border bg-surface">
                  <td className="px-5 py-3.5 text-[12.5px]">{row.name}</td>
                  <td className="px-5 py-3.5">
                    {row.free === true ? (
                      <Check className="size-4 text-positive" aria-label={t("pricing.included")} />
                    ) : (
                      <span className="text-[12.5px] text-muted">{row.free}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {row.pro === true ? (
                      <Check className="size-4 text-positive" aria-label={t("pricing.included")} />
                    ) : (
                      <span className="text-[12.5px] font-semibold text-foreground">{row.pro}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal
        as="section"
        className="mt-6 flex gap-3.5 rounded-2xl border border-border bg-surface p-5"
      >
        <ShieldCheck className="size-5 shrink-0 text-muted-2" />
        <div className="text-[12px] leading-relaxed text-muted">
          <p className="font-semibold text-foreground">{t("pricing.beforeYouPay")}</p>
          <p className="mt-2">
            {provider.assurance} {t("pricing.noteUpfrontPlain")} {t("pricing.noteExpiry")}{" "}
            {t("pricing.noteDisclaimer")}
          </p>
        </div>
      </Reveal>
    </div>
  );
}

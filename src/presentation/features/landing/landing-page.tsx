"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, CandlestickChart, Lock, Mail, Newspaper, Telescope } from "lucide-react";
import { PLAN_CAPABILITIES } from "@/core/domain/access/plan-catalog";
import {
  billingPlan,
  BILLING_PERIODS,
  formatUsd,
  savingsPercent,
  type BillingPeriod,
} from "@/core/domain/billing/plans";
import { BrandLockup } from "@/presentation/ui/brand-logo";
import { useT, type Translate } from "@/presentation/hooks/use-translate";
import { Reveal } from "@/presentation/ui/reveal";
import { domainMessageKey, type MessageKey } from "@/shared/i18n/messages";

/**
 * The public front door.
 *
 * Committed to the dark palette rather than following the reader's theme: it
 * is a designed marketing surface with its own light, and the deep field the
 * hero glow sits on has no light-theme equivalent that would still be the same
 * picture. Everything past Launch App is the app, and the app follows the
 * theme as before.
 */

/** X, formerly Twitter — lucide has no mark for it. */
function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M18.9 2.5h3.4l-7.4 8.5 8.7 11.5h-6.8l-5.3-7-6.1 7H1.9l7.9-9.1L1.5 2.5h7l4.8 6.4 5.6-6.4Zm-1.2 18h1.9L7.4 4.4H5.4l12.3 16.1Z" />
    </svg>
  );
}

function InstagramMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const SOCIALS = [
  { id: "x", href: "https://x.com", Icon: XMark, label: "X" },
  { id: "instagram", href: "https://instagram.com", Icon: InstagramMark, label: "Instagram" },
  { id: "email", href: "mailto:hello@coinsecret.app", Icon: Mail, label: "Email" },
] as const;

/** The four things the product is, or will be. */
const FEATURES = [
  { id: "signals", icon: CandlestickChart, live: true },
  { id: "alpha", icon: Telescope, live: false },
  { id: "unlock", icon: Lock, live: false },
  { id: "news", icon: Newspaper, live: false },
] as const;

function Socials({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {SOCIALS.map(({ id, href, Icon, label }) => (
        <a
          key={id}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="inline-flex size-9 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Icon className="size-[18px]" />
        </a>
      ))}
    </div>
  );
}

/**
 * The first screen: the bar plus this, and nothing else.
 *
 * It used to ask for `86vh`, which on a 960px-tall window left the next
 * section poking 76px above the fold — read as the hero being cut off rather
 * than as a section boundary. Measuring against the bar's own token instead of
 * guessing a percentage is what keeps the two adding up to exactly one screen.
 *
 * `dvh` rather than `vh` so a phone's collapsing URL bar takes the hero with
 * it, instead of leaving its foot below the bottom edge.
 */
function Hero({ t }: { t: Translate }) {
  return (
    <section className="relative flex min-h-[calc(100dvh-var(--landing-bar))] flex-col overflow-hidden">
      {/* The glow the design pools under the headline, breathing rather than
          sitting still. The section clips, so the scaling never reaches the
          document and cannot put a horizontal scrollbar on the page. */}
      <div
        aria-hidden="true"
        className="animate-glow pointer-events-none absolute inset-x-0 bottom-0 h-[68%] bg-[radial-gradient(ellipse_62%_100%_at_50%_100%,rgba(41,86,220,0.55),rgba(41,86,220,0.16)_42%,transparent_78%)]"
      />
      {/* A dimmer violet pool swaying across it on a longer cycle. One light
          breathing alone reads as a pulse; two out of step read as depth. */}
      <div
        aria-hidden="true"
        className="animate-drift pointer-events-none absolute inset-x-0 bottom-0 h-[52%] opacity-70 bg-[radial-gradient(ellipse_38%_100%_at_50%_100%,rgba(124,92,255,0.34),transparent_70%)]"
      />
      <Socials className="relative justify-end px-5 pt-3 sm:px-10" />

      <Reveal
        stagger
        className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-5 pb-28 text-center"
      >
        <h1 className="text-balance text-[34px] font-bold leading-[1.12] tracking-[-0.025em] sm:text-[52px] lg:text-[62px]">
          {t("landing.heroA")}
          <br />
          <span className="text-white/45">{t("landing.heroB")}</span>
        </h1>
        <p className="mt-6 max-w-xl text-pretty text-[12.5px] leading-relaxed text-white/50 sm:text-[13.5px]">
          {t("landing.subhead")}
        </p>
        <Link
          href="/dashboard"
          className="mt-9 inline-flex h-11 items-center rounded-full bg-gradient-to-r from-accent-blue to-accent px-7 text-[14px] font-bold text-white shadow-[0_0_40px_-8px_rgba(79,124,255,0.8)] transition-transform hover:-translate-y-px"
        >
          {t("landing.launchApp")}
        </Link>
      </Reveal>
    </section>
  );
}

function About({ t }: { t: Translate }) {
  return (
    <section id="about" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <Reveal stagger>
          <h2 className="text-center text-[26px] font-bold tracking-tight sm:text-[30px]">
            {t("landing.nav.about")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-[12.5px] leading-relaxed text-white/50">
            {t("landing.aboutBody")}
          </p>
        </Reveal>

        <Reveal stagger className="mt-10 grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
          {FEATURES.map(({ id, icon: Icon, live }) => (
            <div
              key={id}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 transition-colors hover:border-white/20 sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <Icon className="size-[18px] text-accent-blue" />
                  <h3 className="text-[15px] font-semibold">
                    {t(`landing.feature.${id}` as MessageKey)}
                  </h3>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    live ? "bg-accent-blue text-white" : "bg-white/10 text-white/55"
                  }`}
                >
                  {t(live ? "landing.live" : "nav.comingSoon")}
                </span>
              </div>
              <p className="mt-4 text-[12.5px] leading-relaxed text-white/50">
                {t(`landing.feature.${id}Body` as MessageKey)}
              </p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function Pricing({ t }: { t: Translate }) {
  const [period, setPeriod] = useState<BillingPeriod>("annual");
  const plan = billingPlan(period);

  const rows = PLAN_CAPABILITIES.map((capability) => {
    const key = domainMessageKey("capability", capability.id);
    const mark = (value: string | true) =>
      value === true
        ? null
        : domainMessageKey("capability", value === "Terbatas" ? "limited" : "full");
    return {
      id: capability.id,
      name: key ? t(key) : capability.label,
      free: mark(capability.free),
      pro: mark(capability.pro),
    };
  });

  return (
    <section id="pricing" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-4xl px-5 sm:px-8">
        <Reveal stagger>
          <h2 className="text-balance text-center text-[26px] font-bold leading-tight tracking-tight sm:text-[32px]">
            {t("landing.heroA")}
            <br />
            <span className="text-white/45">{t("landing.heroB")}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-center text-[12.5px] leading-relaxed text-white/50">
            {t("landing.subhead")}
          </p>
        </Reveal>

        <div
          role="group"
          aria-label={t("pricing.periodGroup")}
          className="mx-auto mt-8 flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 sm:w-fit sm:flex-nowrap"
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
                  active ? "bg-accent-blue text-white" : "text-white/55 hover:text-white"
                }`}
              >
                {t(`pricing.period.${option}` as MessageKey)}
                {savings > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${
                      active ? "bg-white/20 text-white" : "bg-white/10 text-white/60"
                    }`}
                  >
                    {t("pricing.savings", { percent: savings })}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <Reveal stagger className="mt-8 grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
          {(
            [
              {
                id: "free",
                name: t("common.free"),
                price: "$0",
                blurb: t("pricing.freeBlurb"),
                action: t("pricing.startFree"),
                href: "/register",
                featured: false,
              },
              {
                id: "pro",
                name: t("common.pro"),
                price: formatUsd(plan.perMonthUsd),
                blurb: t("pricing.proBlurb"),
                action: t("landing.getPro", { price: formatUsd(plan.perMonthUsd) }),
                href: "/pricing",
                featured: true,
              },
            ] as const
          ).map((card) => (
            <div
              key={card.id}
              className={`flex flex-col rounded-2xl border p-6 ${
                card.featured
                  ? "border-accent-blue/40 bg-gradient-to-br from-accent-blue/25 via-accent-blue/5 to-transparent"
                  : "border-white/10 bg-white/[0.035]"
              }`}
            >
              <p className="text-[12.5px] font-semibold text-white/60">{card.name}</p>
              <p className="mt-2 flex items-baseline gap-1">
                <span className="text-[40px] font-bold leading-none tracking-tight">{card.price}</span>
                <span className="text-[13px] font-medium text-white/50">{t("pricing.perMonth")}</span>
              </p>
              <p className="mt-3 text-[12px] leading-relaxed text-white/50">{card.blurb}</p>

              <p className="mt-6 text-[12px] font-semibold">{t("pricing.included")}</p>
              <ul className="mt-3 flex-1 space-y-2">
                {rows.map((row) => {
                  const value = card.id === "pro" ? row.pro : row.free;
                  return (
                    <li
                      key={row.id}
                      className="flex items-start gap-2 text-[12px] leading-snug text-white/55"
                    >
                      <Check className="mt-0.5 size-3.5 shrink-0 text-white/35" aria-hidden />
                      <span>
                        {row.name}
                        {value && (
                          <span className="ml-1 font-semibold text-white/85">({t(value)})</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <Link
                href={card.href}
                className={`mt-7 block rounded-xl px-4 py-2.5 text-center text-[13px] font-bold transition-opacity hover:opacity-90 ${
                  card.featured
                    ? "bg-gradient-to-r from-accent-blue to-accent text-white"
                    : "border border-white/15 text-white"
                }`}
              >
                {card.action}
              </Link>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function LandingPage() {
  const { t } = useT();

  return (
    <div className="min-h-dvh bg-[#05070d] text-white">
      {/* The design's bar is the wordmark alone, centred. */}
      <header className="flex h-(--landing-bar) items-center justify-center border-b border-white/[0.07]">
        <Link href="/" aria-label={t("landing.home")}>
          <BrandLockup height={24} tone="dark" />
        </Link>
      </header>

      <main>
        <Hero t={t} />
        <About t={t} />
        <Pricing t={t} />
      </main>

      <footer className="border-t border-white/[0.07] bg-white/[0.02]">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-5 py-8 sm:flex-row sm:justify-between">
          <BrandLockup height={20} tone="dark" />
          <nav
            className="flex items-center gap-7 text-[12.5px] text-white/55"
            aria-label={t("nav.primary")}
          >
            <a href="#about" className="transition-colors hover:text-white">
              {t("landing.nav.about")}
            </a>
            <a href="#about" className="transition-colors hover:text-white">
              {t("landing.nav.features")}
            </a>
            <a href="#pricing" className="transition-colors hover:text-white">
              {t("nav.pricing")}
            </a>
          </nav>
          <Socials />
        </div>
        <p className="border-t border-white/[0.06] py-5 text-center text-[11.5px] text-white/35">
          {t("landing.copyright", { year: new Date().getFullYear() })}
        </p>
      </footer>
    </div>
  );
}

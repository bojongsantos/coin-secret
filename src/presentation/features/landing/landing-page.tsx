"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Sparkles } from "lucide-react";
import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { BrandLockup, BrandMark } from "@/presentation/ui/brand-logo";
import { LanguageToggle } from "@/presentation/ui/language-toggle";
import { useT, type Translate } from "@/presentation/hooks/use-translate";
import type { MessageKey } from "@/shared/i18n/messages";

/**
 * The public front door.
 *
 * Committed to the dark palette rather than following the reader's theme: it
 * is a designed marketing surface with its own light, and the deep field the
 * hero glow sits on has no light-theme equivalent that would still be the same
 * picture. Everything past the Launch App button is the app, and the app
 * follows the theme as before.
 */

/** Sections the nav promises, in the order they appear. */
const SECTIONS = [
  { id: "about", label: "landing.nav.about" },
  { id: "technologies", label: "landing.nav.technologies" },
  { id: "products", label: "landing.nav.products" },
] as const satisfies ReadonlyArray<{ id: string; label: MessageKey }>;

/** Nav height, so a section does not land underneath the bar. */
const SCROLL_OFFSET = 72;
const SCROLL_MS = 520;

/**
 * Scrolls to a section by id, animated by hand.
 *
 * Two things make the obvious version fail here.
 *
 * A page can render twice — React's streaming SSR leaves a hidden, zero-height
 * copy first in document order — so a plain `#anchor` link, and
 * `getElementById` with it, can resolve to the copy nobody can see and scroll
 * nowhere. The visible one is whichever is not inside a `[hidden]` container.
 *
 * And native smooth scrolling does nothing in this app. Measured on this page:
 * `scrollTo(0, 600)` lands at 600 and `scrollTop = 1500` lands at 1500, while
 * `scrollTo({ behavior: "smooth" })` leaves the page exactly where it was.
 * Instant jumps work, so the glide is tweened here instead of asked for.
 */
function scrollToSection(id: string): void {
  const target = [...document.querySelectorAll(`[id="${CSS.escape(id)}"]`)].find(
    (element) => element.closest("[hidden]") === null,
  );
  if (!(target instanceof HTMLElement)) return;

  const root = document.documentElement;
  const from = window.scrollY || root.scrollTop || 0;
  const limit = Math.max(0, root.scrollHeight - window.innerHeight);
  const to = Math.min(Math.max(0, target.offsetTop - SCROLL_OFFSET), limit);
  if (Math.abs(to - from) < 1) return;

  // Someone who has asked their system to stop animating gets the jump — and
  // so does a page the browser is not drawing, because `requestAnimationFrame`
  // is not called at all while a tab is hidden and the tween would stall part
  // of the way down.
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.hidden
  ) {
    root.scrollTop = to;
    return;
  }

  const started = performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - started) / SCROLL_MS);
    // Ease-out cubic: quick to leave, gentle to arrive.
    const eased = 1 - Math.pow(1 - progress, 3);
    root.scrollTop = from + (to - from) * eased;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A four-pointed star, the decoration scattered across the hero. */
function Star({ className, size }: { className: string; size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`pointer-events-none absolute ${className}`}
    >
      <path
        d="M12 0c.6 6.2 5.2 10.8 12 12-6.8 1.2-11.4 5.8-12 12-.6-6.2-5.2-10.8-12-12C6.8 10.8 11.4 6.2 12 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Fixed positions rather than random ones: a random field would differ between
 * the server render and the browser's, and React would replace the whole hero
 * on hydration to reconcile it.
 */
const STARS = [
  { className: "left-[6%] top-[12%] text-white/25", size: 11 },
  { className: "left-[18%] top-[38%] text-white/15", size: 9 },
  { className: "left-[32%] top-[16%] text-white/20", size: 13 },
  { className: "left-[8%] top-[64%] text-white/20", size: 12 },
  { className: "left-[68%] top-[14%] text-white/15", size: 10 },
  { className: "left-[95%] top-[30%] text-white/25", size: 12 },
  { className: "left-[86%] top-[72%] text-white/15", size: 10 },
  { className: "left-[36%] top-[88%] text-white/30", size: 22 },
] as const;

function LandingNav({ t }: { t: Translate }) {
  const jump = useCallback((id: string) => scrollToSection(id), []);

  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-[#05070d]/80 backdrop-blur-md">
      <nav
        aria-label={t("nav.primary")}
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8"
      >
        {/* Three tracks so the wordmark sits on the page's centre line rather
            than in the middle of whatever the links happen to measure. */}
        <div className="hidden flex-1 items-center gap-7 lg:flex">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => jump(section.id)}
              className="text-[13px] font-medium text-white/70 transition-colors hover:text-white"
            >
              {t(section.label)}
            </button>
          ))}
        </div>

        {/* The full lockup is 209px wide — over half a phone. Narrow screens
            get the mark alone, which is what leaves room for Pricing to stay
            reachable from the bar rather than only from far down the page. */}
        <Link href="/" className="flex shrink-0 items-center lg:flex-none" aria-label={t("landing.home")}>
          <BrandMark size={24} className="sm:hidden" tone="dark" />
          <BrandLockup height={26} tone="dark" className="hidden sm:block" />
        </Link>

        <div className="flex flex-1 items-center justify-end gap-3">
          <Link
            href="/pricing"
            className="text-[13px] font-medium text-white/70 transition-colors hover:text-white"
          >
            {t("nav.pricing")}
          </Link>
          <Link
            href="/pricing"
            className="hidden text-[13px] font-medium text-white/70 transition-colors hover:text-white lg:block"
          >
            {t("landing.nav.buyPremium")}
          </Link>
          <LanguageToggle className="border-white/15 bg-white/5 text-white/70 hover:border-white/30 hover:text-white" />
          <Link
            href="/dashboard"
            className="inline-flex h-9 shrink-0 items-center rounded-full bg-gradient-to-r from-accent to-accent-blue px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {t("landing.launchApp")}
          </Link>
        </div>
      </nav>
    </header>
  );
}

function Hero({ t }: { t: Translate }) {
  return (
    <section className="relative overflow-hidden">
      {/* The glow the design pools at the foot of the hero. Two layers: a wide
          soft wash, and a tighter core so the centre reads as a source rather
          than as an evenly lit panel. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[74%] bg-[radial-gradient(ellipse_72%_100%_at_50%_100%,rgba(79,124,255,0.52),rgba(79,124,255,0.20)_40%,rgba(79,124,255,0.05)_66%,transparent_82%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[40%] bg-[radial-gradient(ellipse_30%_100%_at_50%_100%,rgba(124,92,255,0.40),transparent_74%)]"
      />
      {STARS.map((star) => (
        <Star key={star.className} className={star.className} size={star.size} />
      ))}

      <div className="relative mx-auto flex min-h-[86vh] max-w-4xl flex-col items-center justify-center px-5 pb-28 pt-32 text-center sm:pt-36">
        <p className="text-[13px] font-medium tracking-wide text-white/55">{t("landing.eyebrow")}</p>

        <h1 className="mt-4 text-balance text-[34px] font-semibold leading-[1.14] tracking-[-0.02em] text-white sm:text-[46px] lg:text-[56px]">
          {t("landing.headline", { pairs: DEFAULT_WATCHLIST.length })}
        </h1>

        <p className="mt-6 max-w-2xl text-pretty text-[13.5px] leading-relaxed text-white/55 sm:text-[15px]">
          {t("landing.subhead")}
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-[#0a0d16] transition-transform hover:-translate-y-px"
          >
            {t("landing.launchApp")}
            <Sparkles className="size-4 text-accent" />
          </Link>
          {/* The design put a Download here, and there is nothing to download:
              Coin Secret runs in the browser. The slot keeps its shape and
              carries an action that exists. */}
          <button
            type="button"
            onClick={() => scrollToSection("about")}
            className="inline-flex h-11 items-center rounded-full border border-white/25 px-6 text-[14px] font-semibold text-white transition-colors hover:border-white/50 hover:bg-white/5"
          >
            {t("landing.howItWorks")}
          </button>
        </div>
      </div>
    </section>
  );
}

/** One numbered claim, and the sentence that backs it. */
function Point({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <span className="inline-flex size-7 items-center justify-center rounded-full border border-white/15 text-[12px] font-bold text-white/60">
        {index}
      </span>
      <h3 className="mt-4 text-[15px] font-semibold text-white">{title}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-white/55">{body}</p>
    </li>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-white/[0.07] py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent-2">{eyebrow}</p>
        <h2 className="mt-3 max-w-2xl text-balance text-[26px] font-semibold leading-tight tracking-[-0.01em] text-white sm:text-[32px]">
          {title}
        </h2>
        <div className="mt-9">{children}</div>
      </div>
    </section>
  );
}

export function LandingPage() {
  const { t } = useT();
  const pairs = DEFAULT_WATCHLIST.length;

  return (
    <div className="min-h-dvh bg-[#05070d] text-white">
      <LandingNav t={t} />

      <main>
        <Hero t={t} />

        <Section id="about" eyebrow={t("landing.nav.about")} title={t("landing.about.title")}>
          <ul className="grid gap-4 sm:grid-cols-3">
            <Point index={1} title={t("landing.about.p1.title")} body={t("landing.about.p1.body")} />
            <Point index={2} title={t("landing.about.p2.title")} body={t("landing.about.p2.body")} />
            <Point index={3} title={t("landing.about.p3.title")} body={t("landing.about.p3.body")} />
          </ul>
        </Section>

        <Section
          id="technologies"
          eyebrow={t("landing.nav.technologies")}
          title={t("landing.tech.title")}
        >
          <dl className="grid gap-x-10 gap-y-7 sm:grid-cols-2">
            {(
              [
                ["landing.tech.rules", "landing.tech.rulesBody"],
                ["landing.tech.data", "landing.tech.dataBody"],
                ["landing.tech.lifecycle", "landing.tech.lifecycleBody"],
                ["landing.tech.archive", "landing.tech.archiveBody"],
              ] as ReadonlyArray<[MessageKey, MessageKey]>
            ).map(([title, body]) => (
              <div key={title}>
                <dt className="text-[15px] font-semibold text-white">{t(title)}</dt>
                <dd className="mt-2 text-[13px] leading-relaxed text-white/55">
                  {t(body, { pairs })}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="products" eyebrow={t("landing.nav.products")} title={t("landing.products.title")}>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["landing.products.board", "landing.products.boardBody", "/dashboard"],
                ["landing.products.plan", "landing.products.planBody", "/dashboard"],
                ["landing.products.reasoning", "landing.products.reasoningBody", "/dashboard"],
                ["landing.products.scanner", "landing.products.scannerBody", "/scanner"],
              ] as ReadonlyArray<[MessageKey, MessageKey, string]>
            ).map(([title, body, href]) => (
              <Link
                key={title}
                href={href}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/25 hover:bg-white/[0.06]"
              >
                <h3 className="text-[15px] font-semibold text-white group-hover:text-accent-2">
                  {t(title)}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/55">{t(body, { pairs })}</p>
              </Link>
            ))}
          </div>
        </Section>

        <section className="border-t border-white/[0.07] py-20">
          <div className="mx-auto max-w-3xl px-5 text-center">
            <h2 className="text-balance text-[26px] font-semibold leading-tight text-white sm:text-[30px]">
              {t("landing.cta.title")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[13.5px] leading-relaxed text-white/55">
              {t("landing.cta.body")}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-[#0a0d16] transition-transform hover:-translate-y-px"
              >
                {t("landing.launchApp")}
                <Sparkles className="size-4 text-accent" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex h-11 items-center rounded-full border border-white/25 px-6 text-[14px] font-semibold text-white transition-colors hover:border-white/50 hover:bg-white/5"
              >
                {t("nav.pricing")}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.07] py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-5 text-center sm:flex-row sm:justify-between sm:text-left">
          <BrandLockup height={20} tone="dark" className="opacity-60" />
          <p className="text-[11px] text-white/40">{t("landing.disclaimer")}</p>
        </div>
      </footer>
    </div>
  );
}

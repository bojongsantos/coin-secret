"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CandlestickChart,
  CreditCard,
  LayoutGrid,
  Lock,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Telescope,
} from "lucide-react";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { useSidebarState } from "@/presentation/hooks/use-ui-preference";
import { useT } from "@/presentation/hooks/use-translate";
import { BrandLockup, BrandMark, BRAND_NAME } from "@/presentation/ui/brand-logo";
import type { MessageKey } from "@/shared/i18n/messages";
import { toggledSidebar } from "@/shared/lib/ui-preferences";

interface NavItem {
  id: string;
  label: MessageKey;
  href: string;
  icon: typeof LayoutGrid;
  /** Named in the design, but there is nothing behind it yet. */
  soon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "nav.dashboard", href: "/dashboard", icon: LayoutGrid },
  { id: "signals", label: "nav.signals", href: "/signals", icon: CandlestickChart },
  { id: "alpha", label: "nav.alphaReport", href: "#", icon: Telescope, soon: true },
  { id: "unlock", label: "nav.tokenUnlock", href: "#", icon: Lock, soon: true },
  { id: "news", label: "nav.news", href: "#", icon: Newspaper, soon: true },
  { id: "pricing", label: "nav.pricing", href: "/pricing", icon: CreditCard },
];

/** The width the main column is offset by, expanded and collapsed. */
export const SIDEBAR_WIDTH = 284;
export const SIDEBAR_WIDTH_COLLAPSED = 96;

/**
 * The app's left rail.
 *
 * A floating panel rather than a full-height column: it is inset on every side,
 * which is what lets the page's own background show around it. Fixed, so the
 * document itself is what scrolls — the previous shell scrolled inside a nested
 * `<main>`, and in a nested scroller every smooth scroll in the app was a
 * silent no-op.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { plan, authenticated } = usePlan();
  const { sidebar, setSidebar } = useSidebarState();
  const { t } = useT();

  const collapsed = sidebar === "collapsed";
  const pro = plan === "premium";

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden p-3 lg:block"
      style={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH }}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-surface to-surface-2 shadow-2xl">
        <div className={`flex h-24 shrink-0 items-center ${collapsed ? "justify-center px-2" : "px-6"}`}>
          <Link href="/dashboard" aria-label={t("nav.dashboardHome", { brand: BRAND_NAME })}>
            {collapsed ? <BrandMark size={26} /> : <BrandLockup height={26} />}
          </Link>
        </div>

        <nav className={`flex-1 space-y-1.5 overflow-y-auto ${collapsed ? "px-2" : "px-4"}`}>
          {NAV_ITEMS.map((item) => {
            const active = !item.soon && pathname === item.href;
            const label = t(item.label);
            const body = (
              <>
                {/* The accent bar is what makes the current page readable at a
                    glance; a tinted background alone is too quiet on this
                    palette. */}
                <span
                  aria-hidden
                  className={`absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full transition-colors ${
                    active ? "bg-accent-blue" : "bg-transparent"
                  }`}
                />
                <item.icon
                  className={`size-[18px] shrink-0 ${active ? "text-foreground" : "text-muted-2 group-hover:text-muted"}`}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{label}</span>
                    {item.soon && (
                      <span className="shrink-0 rounded-full bg-accent-blue/20 px-1.5 py-0.5 text-[9px] font-bold leading-[14px] text-accent-blue">
                        {t("nav.comingSoon")}
                      </span>
                    )}
                  </>
                )}
              </>
            );
            const className = `group relative flex w-full items-center rounded-xl text-[13.5px] transition-colors ${
              collapsed ? "justify-center px-0 py-3" : "gap-2.5 py-3 pl-3.5 pr-2.5"
            } ${
              active
                ? "bg-surface-3 font-semibold text-foreground"
                : "font-medium text-muted hover:bg-surface-3/60 hover:text-foreground"
            }`;

            // Nothing is behind the three that are still being built, so they
            // are not links at all rather than links that go nowhere.
            return item.soon ? (
              <span key={item.id} className={`${className} cursor-default`} title={collapsed ? label : undefined}>
                {body}
                {collapsed && <span className="sr-only">{label}</span>}
              </span>
            ) : (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
                className={className}
              >
                {body}
                {collapsed && <span className="sr-only">{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className={`shrink-0 space-y-3 pb-5 ${collapsed ? "px-2" : "px-4"}`}>
          <button
            type="button"
            onClick={() => setSidebar(toggledSidebar(sidebar))}
            aria-expanded={!collapsed}
            title={t(collapsed ? "nav.openSidebar" : "nav.closeSidebar")}
            className={`flex w-full items-center rounded-xl border border-border bg-surface-3/60 text-[12.5px] font-semibold text-muted transition-colors hover:border-border-strong hover:text-foreground ${
              collapsed ? "justify-center py-2.5" : "gap-2.5 px-3.5 py-2.5"
            }`}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && t("nav.closeSidebar")}
          </button>

          {!collapsed && (
            <div
              className={`rounded-2xl p-4 ${
                pro
                  ? "bg-gradient-to-br from-accent-blue to-accent text-white"
                  : "border border-border bg-surface-3/60"
              }`}
            >
              <p className={`text-[12.5px] font-bold ${pro ? "text-white" : "text-foreground"}`}>
                {t(pro ? "sidebar.proTitle" : "sidebar.freeTitle")}
              </p>
              <p className={`mt-1 text-[11.5px] leading-snug ${pro ? "text-white/85" : "text-muted"}`}>
                {t(pro ? "sidebar.proBody" : authenticated ? "sidebar.freeBody" : "sidebar.guestBody")}
              </p>
              {!pro && (
                <Link
                  href="/pricing"
                  className="mt-3 block rounded-lg bg-gradient-to-r from-accent-blue to-accent px-3 py-2 text-center text-[12px] font-bold text-white transition-opacity hover:opacity-90"
                >
                  {t("common.unlockPro")}
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

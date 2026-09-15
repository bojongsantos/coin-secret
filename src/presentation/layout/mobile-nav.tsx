"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CandlestickChart,
  CreditCard,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  Newspaper,
  Telescope,
  UserCog,
  X,
} from "lucide-react";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { useT } from "@/presentation/hooks/use-translate";
import type { MessageKey } from "@/shared/i18n/messages";

interface Item {
  href: string;
  label: MessageKey;
  icon: typeof LayoutGrid;
  soon?: boolean;
}

/** Destinations that earn a permanent slot on a phone-width bar. */
const PRIMARY: Item[] = [
  { href: "/dashboard", label: "nav.dashboard", icon: LayoutGrid },
  { href: "/signals", label: "nav.signals", icon: CandlestickChart },
];

/** Everything else, reachable through the overflow sheet. */
const SECONDARY: Item[] = [
  { href: "/pricing", label: "nav.pricing", icon: CreditCard },
  { href: "/account", label: "nav.account", icon: UserCog },
  { href: "#", label: "nav.alphaReport", icon: Telescope, soon: true },
  { href: "#", label: "nav.tokenUnlock", icon: Lock, soon: true },
  { href: "#", label: "nav.news", icon: Newspaper, soon: true },
];

/**
 * Phone navigation: a fixed bottom bar, plus a sheet for the rest.
 *
 * Controlled by the shell so the top bar's menu button and this bar's own
 * "More" open the same sheet rather than two that can disagree.
 */
export function MobileNav({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const { canAccess } = usePlan();
  const { t } = useT();

  // The sheet is a navigation overlay, so it must not survive a route change.
  // Closed while rendering the new route, so it never flashes over the page.
  const [trackedPath, setTrackedPath] = useState(pathname);
  if (pathname !== trackedPath) {
    setTrackedPath(pathname);
    if (open) onOpenChange(false);
  }

  useEffect(() => {
    if (!open) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, onOpenChange]);

  const isActive = (href: string) => href !== "#" && pathname.startsWith(href);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t("nav.closeMenu")}
            onClick={() => onOpenChange(false)}
            className="animate-fade absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.moreMenu")}
            className="animate-sheet absolute inset-x-0 bottom-16 rounded-t-3xl border-t border-border bg-surface p-3 shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-2">{t("nav.more")}</p>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={t("nav.closeMenu")}
                className="rounded-lg border border-border p-1.5 text-muted-2 transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {SECONDARY.map((item) =>
                item.soon ? (
                  <span
                    key={item.label}
                    className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-[13px] font-medium text-muted-2"
                  >
                    <item.icon className="size-4" />
                    <span className="truncate">{t(item.label)}</span>
                    <span className="ml-auto shrink-0 rounded-full bg-accent-blue/20 px-1.5 py-0.5 text-[9px] font-bold text-accent-blue">
                      {t("nav.comingSoon")}
                    </span>
                  </span>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-[13px] font-medium transition-colors ${
                      isActive(item.href)
                        ? "bg-accent-blue/10 text-foreground"
                        : "text-muted hover:bg-surface-3 hover:text-foreground"
                    }`}
                  >
                    <item.icon className="size-4 text-muted-2" />
                    {t(item.label)}
                  </Link>
                ),
              )}
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label={t("nav.primary")}
        className="fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-3 border-t border-border bg-surface/95 backdrop-blur lg:hidden"
      >
        {PRIMARY.map((item) => {
          const active = isActive(item.href);
          const locked = item.href === "/signals" && !canAccess("signals");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
                active ? "text-accent-blue" : "text-muted-2"
              }`}
            >
              <item.icon className="size-[18px]" />
              {t(item.label)}
              {locked && <Lock className="absolute right-1/2 top-2.5 size-2.5 translate-x-5 text-warning" />}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-label={t("nav.moreMenu")}
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
            open ? "text-accent-blue" : "text-muted-2"
          }`}
        >
          <MoreHorizontal className="size-[18px]" />
          {t("nav.more")}
        </button>
      </nav>
    </>
  );
}

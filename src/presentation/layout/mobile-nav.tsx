"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  Layers,
  LayoutDashboard,
  Lock,
  MoreHorizontal,
  Radar,
  UserCog,
  X,
} from "lucide-react";
import { usePlan } from "@/presentation/features/access/plan-provider";

/** Destinations that earn a permanent slot on a phone-width bar. */
const PRIMARY = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patterns", label: "Signals", icon: Layers },
];

/** Everything else, reachable through the overflow sheet. */
const SECONDARY = [
  { href: "/scanner", label: "Scanner", icon: Radar },
  { href: "/pricing", label: "Pricing", icon: CreditCard },
  { href: "/account", label: "Akun", icon: UserCog },
];

export function MobileNav() {
  const pathname = usePathname();
  const { canAccess } = usePlan();
  const [open, setOpen] = useState(false);

  // The sheet is a navigation overlay, so it must not survive a route change.
  // Closed while rendering the new route, so it never flashes over the page.
  const [trackedPath, setTrackedPath] = useState(pathname);
  if (pathname !== trackedPath) {
    setTrackedPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const secondaryActive = SECONDARY.some((item) => isActive(item.href));

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu lainnya"
            className="absolute inset-x-0 bottom-16 rounded-t-2xl border-t border-border bg-surface p-3 shadow-2xl"
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-2">Lainnya</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup menu"
                className="rounded-lg border border-border p-1.5 text-muted-2 transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {SECONDARY.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-[13px] font-medium transition-colors ${
                    isActive(item.href)
                      ? "bg-accent/10 text-foreground"
                      : "text-muted hover:bg-surface-3 hover:text-foreground"
                  }`}
                >
                  <item.icon className="size-4 text-muted-2" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label="Navigasi utama"
        className="fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-5 border-t border-border bg-surface/95 backdrop-blur lg:hidden"
      >
        {PRIMARY.map((item) => {
          const active = isActive(item.href);
          const locked = item.href === "/patterns" && !canAccess("signals");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
                active ? "text-accent-2" : "text-muted-2"
              }`}
            >
              <item.icon className="size-4" />
              {item.label}
              {locked && <Lock className="absolute right-1/2 top-2 size-2.5 translate-x-4 text-warning" />}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label="Menu lainnya"
          className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
            open || secondaryActive ? "text-accent-2" : "text-muted-2"
          }`}
        >
          <MoreHorizontal className="size-4" />
          Lainnya
        </button>
      </nav>
    </>
  );
}

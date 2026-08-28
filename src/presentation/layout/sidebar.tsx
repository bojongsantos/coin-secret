"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  Layers,
  LayoutDashboard,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { useSidebarState } from "@/presentation/hooks/use-ui-preference";
import { BrandLockup, BrandMark, BRAND_NAME } from "@/presentation/ui/brand-logo";
import { toggledSidebar } from "@/shared/lib/ui-preferences";

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/", icon: LayoutDashboard },
  { id: "signals", label: "Signals", href: "/patterns", icon: Layers },
  { id: "pricing", label: "Pricing", href: "/pricing", icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();
  const { authenticated, plan, canAccess } = usePlan();
  const { sidebar, setSidebar } = useSidebarState();

  const collapsed = sidebar === "collapsed";
  const lockedItems = new Set<string>(canAccess("signals") ? [] : ["signals"]);
  const toggleLabel = collapsed ? "Buka sidebar" : "Tutup sidebar";

  return (
    <aside
      className={`hidden h-full shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <div
        className={`flex h-16 items-center border-b border-border ${
          collapsed ? "justify-center px-2" : "px-5"
        }`}
      >
        <Link href="/" aria-label={`${BRAND_NAME} dashboard`}>
          {/* The mark alone when collapsed: the wordmark would be clipped
              mid-name, which reads as a broken image rather than a compact one. */}
          {collapsed ? <BrandMark size={24} /> : <BrandLockup height={26} />}
        </Link>
      </div>

      <nav className={`flex-1 space-y-1 overflow-y-auto py-4 ${collapsed ? "px-2" : "px-3"}`}>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const locked = lockedItems.has(item.id);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              // Collapsed, the icon is the only cue left, so the name moves
              // into the tooltip rather than disappearing entirely.
              title={collapsed ? item.label : undefined}
              className={`group relative flex w-full items-center rounded-lg text-[13px] transition-colors ${
                collapsed ? "justify-center px-0 py-2.5" : "gap-3 py-2.5 pl-4 pr-3"
              } ${
                active
                  ? "bg-accent/10 font-semibold text-foreground"
                  : "font-medium text-muted hover:bg-surface-3 hover:text-foreground"
              }`}
            >
              {/* A short accent bar makes the current page readable at a glance,
                  rather than relying on a faint background tint alone. */}
              <span
                aria-hidden
                className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full transition-colors ${
                  active ? "bg-accent-2" : "bg-transparent"
                }`}
              />
              <item.icon
                className={`size-4 shrink-0 ${active ? "text-accent-2" : "text-muted-2 group-hover:text-muted"}`}
              />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {locked && <Lock className="size-3.5 shrink-0 text-warning" />}
                </>
              )}
              {collapsed && locked && (
                <Lock className="absolute right-1 top-1 size-3 text-warning" />
              )}
              {/* Collapsed, the link's only content is an icon, so the name
                  has to reach assistive tech some other way. */}
              {collapsed && <span className="sr-only">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-border ${collapsed ? "p-2" : "p-4"}`}>
        <button
          type="button"
          onClick={() => setSidebar(toggledSidebar(sidebar))}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          className={`flex w-full items-center rounded-lg border border-border bg-surface-3 text-[12px] font-semibold text-muted transition-colors hover:border-border-strong hover:text-foreground ${
            collapsed ? "justify-center py-2.5" : "gap-2 px-3 py-2.5"
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <>
              <PanelLeftClose className="size-4" />
              Tutup sidebar
            </>
          )}
        </button>

        {!collapsed && (
          <div className="card mt-3 p-4">
            <p className="text-[12px] font-semibold">
              {authenticated ? `Paket ${plan === "premium" ? "Premium" : "Free"}` : "Akun Coin Secret"}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted">
              {!authenticated
                ? "Masuk untuk mengaktifkan Premium dan membuka seluruh signals."
                : plan === "premium"
                  ? "Premium aktif. Seluruh fitur dan scanner tersedia."
                  : "Free aktif. Tiga setup teratas per sisi terbuka untuk Anda."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

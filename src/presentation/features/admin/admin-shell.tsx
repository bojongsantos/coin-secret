"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  Lock,
  Users,
  CreditCard,
  ScrollText,
  ImageIcon,
} from "lucide-react";
import { BrandLockup } from "@/presentation/ui/brand-logo";

const NAV = [
  { id: "overview", label: "Overview", href: "/admin", icon: LayoutDashboard },
  { id: "users", label: "Users", href: "/admin/users", icon: Users },
  { id: "payments", label: "Payments", href: "/admin/payments", icon: CreditCard },
  { id: "audit", label: "Audit Log", href: "/admin/audit", icon: ScrollText },
  { id: "watchlist", label: "Watchlist", href: "/admin/watchlist", icon: ListOrdered },
  { id: "scanner", label: "Scanner Log", href: "/admin/scanner", icon: Activity },
  { id: "results", label: "Setup Results", href: "/admin/results", icon: ImageIcon },
  { id: "gating", label: "Plan & Gating", href: "/admin/gating", icon: Lock },
  { id: "health", label: "API Health", href: "/admin/health", icon: Gauge },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <BrandLockup height={26} />
          <span className="rounded-md border border-border bg-surface-3 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-2">
            Admin
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {NAV.map((item) => {
            const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-accent/10 text-foreground"
                    : "text-muted hover:bg-surface-3 hover:text-foreground"
                }`}
              >
                <item.icon className={`size-4 ${active ? "text-accent-2" : "text-muted-2"}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-3 px-3 py-2 text-[12px] font-semibold text-muted transition-colors hover:text-foreground"
          >
            <LayoutDashboard className="size-3.5" />
            Back to app
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-6">
          <h1 className="text-sm font-bold tracking-tight">Coin Secret Backoffice</h1>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-2">
            <span className="size-1.5 rounded-full bg-positive" />
            Live · PostgreSQL
          </span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

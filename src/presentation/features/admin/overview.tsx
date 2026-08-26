"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface Stats { users: number; premiumUsers: number; activeSubscriptions: number; revenueIdr: number; pendingPayments: number }

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => { fetch("/api/admin/overview", { cache: "no-store" }).then((response) => response.json()).then(setStats).catch(() => setStats(null)); }, []);
  if (!stats) return <div className="flex h-64 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted" /></div>;
  const cards = [
    ["Total Users", stats.users.toLocaleString("id-ID")],
    ["Premium Users", stats.premiumUsers.toLocaleString("id-ID")],
    ["Active Subscriptions", stats.activeSubscriptions.toLocaleString("id-ID")],
    ["Revenue", new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(stats.revenueIdr)],
    ["Pending Payments", stats.pendingPayments.toLocaleString("id-ID")],
  ];
  return <div className="p-6"><h2 className="text-lg font-bold">Overview Backend</h2><p className="mt-1 text-xs text-muted">Data langsung dari PostgreSQL.</p><div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <section key={label} className="card p-5"><p className="text-xs uppercase tracking-wide text-muted-2">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></section>)}</div></div>;
}

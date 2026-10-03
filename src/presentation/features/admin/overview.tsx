"use client";

import { z } from "zod";
import { AdminFeedback, useAdminData } from "./admin-data";
import { useT } from "@/presentation/hooks/use-translate";

const statsSchema = z.object({ users: z.number(), premiumUsers: z.number(), activeSubscriptions: z.number(), pendingPayments: z.number(), revenue: z.array(z.object({ currency: z.string().length(3), amount: z.number() })) });
type Stats = z.infer<typeof statsSchema>;
const validStats = (value: unknown): value is Stats => statsSchema.safeParse(value).success;

export function Overview() {
  const { t } = useT();
  const { data: stats, loading, error, reload } = useAdminData("/api/admin/overview", validStats);
  if (!stats || loading) return <div className="p-6"><AdminFeedback loading={loading} error={error} retry={() => void reload()} /></div>;
  const revenue = stats.revenue.length > 0
    ? stats.revenue.map((item) => new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: item.currency,
        maximumFractionDigits: 0,
      }).format(item.amount)).join(" · ")
    : "—";
  const cards = [
    ["Total Users", stats.users.toLocaleString("id-ID")],
    ["Premium Users", stats.premiumUsers.toLocaleString("id-ID")],
    ["Active Subscriptions", stats.activeSubscriptions.toLocaleString("id-ID")],
    ["Revenue", revenue],
    ["Pending Payments", stats.pendingPayments.toLocaleString("id-ID")],
  ];
  return <div className="p-6"><h2 className="text-lg font-bold">Overview Backend</h2><p className="mt-1 text-xs text-muted">{t("admin.overviewBlurb")}</p><div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <section key={label} className="card p-5"><p className="text-xs uppercase tracking-wide text-muted-2">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></section>)}</div></div>;
}

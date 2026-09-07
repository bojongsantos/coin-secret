"use client";

import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import type { CurrentUserDto } from "@/core/domain/identity";
import { authClient } from "@/infrastructure/auth/auth-client";
import Link from "next/link";
import { billingPlan, formatUsd } from "@/core/domain/billing/plans";
import { useT } from "@/presentation/hooks/use-translate";

export function AccountModule({ user }: { user: CurrentUserDto }) {
  const { t, locale } = useT();
  const [payments, setPayments] = useState<{ id: string; orderId: string; amount: number; currency: string; status: string; createdAt: string }[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/billing/history", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((payload: { payments?: typeof payments }) => setPayments(payload.payments ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function changePassword() {
    const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setAccountMessage(result.error ? (result.error.message ?? t("billing.passwordFailed")) : t("billing.passwordChanged"));
    if (!result.error) { setCurrentPassword(""); setNewPassword(""); }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
      <div><h1 className="text-xl font-bold">{t("billing.title")}</h1><p className="mt-1 text-sm text-muted">{t("billing.subtitle")}</p></div>
      <section className="card p-5"><h2 className="text-sm font-bold">{t("billing.profile")}</h2><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted">{t("auth.name")}</dt><dd className="mt-1 font-semibold">{user.name}</dd></div><div><dt className="text-xs text-muted">{t("auth.email")}</dt><dd className="mt-1 font-semibold">{user.email} · {t(user.emailVerified ? "billing.verified" : "billing.unverified")}</dd></div><div><dt className="text-xs text-muted">{t("billing.role")}</dt><dd className="mt-1 font-semibold">{user.role}</dd></div><div><dt className="text-xs text-muted">{t("billing.plan")}</dt><dd className="mt-1 font-semibold">{user.plan}</dd></div></dl></section>
      <section className="card p-5"><h2 className="text-sm font-bold">{t("billing.changePassword")}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={t("billing.currentPassword")} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" /><input type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t("billing.newPassword")} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div><button onClick={() => void changePassword()} disabled={!currentPassword || newPassword.length < 10} className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-40">{t("billing.savePassword")}</button>{accountMessage && <p className="mt-2 text-xs text-muted">{accountMessage}</p>}</section>
      <section className="card p-5"><div className="flex items-center gap-2"><Crown className="size-5 text-warning" /><h2 className="text-sm font-bold">Coin Secret Pro</h2></div><p className="mt-2 text-sm text-muted">{t("billing.proPitch")}</p><p className="mt-4 text-2xl font-bold">{formatUsd(billingPlan("annual").perMonthUsd)} <span className="text-xs font-normal text-muted">{t("billing.perMonthAnnual")}</span></p>{user.plan === "PREMIUM" ? <p className="mt-4 text-sm font-semibold text-positive">{t("billing.proActive")}</p> : <Link href="/pricing" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-blue px-4 py-2.5 text-sm font-bold text-white">{t("billing.seePlans")}</Link>}</section>
      <section className="card p-5"><h2 className="text-sm font-bold">{t("billing.history")}</h2>{payments.length === 0 ? <p className="mt-3 text-sm text-muted">{t("billing.noPayments")}</p> : <div className="mt-3 divide-y divide-border">{payments.map((payment) => <div key={payment.id} className="flex flex-wrap items-center gap-3 py-3 text-xs"><span className="font-mono text-muted">{payment.orderId}</span><span className="ml-auto font-semibold">{new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", { style: "currency", currency: payment.currency, maximumFractionDigits: 0 }).format(payment.amount)}</span><span className="rounded-md border border-border px-2 py-1 font-bold">{payment.status}</span></div>)}</div>}</section>
    </div>
  );
}

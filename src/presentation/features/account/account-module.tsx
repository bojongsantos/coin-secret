"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Crown } from "lucide-react";
import type { CurrentUserDto } from "@/core/domain/identity";
import { billingPlan, formatUsd } from "@/core/domain/billing/plans";
import { authClient } from "@/infrastructure/auth/auth-client";
import { useT } from "@/presentation/hooks/use-translate";
import { Reveal } from "@/presentation/ui/reveal";

interface PaymentRow {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
}

/** A labelled value in the profile grid. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] text-muted-2">{label}</dt>
      <dd className="mt-1 text-[13.5px] font-semibold">{children}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-[14px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function AccountModule({ user }: { user: CurrentUserDto }) {
  const { t, locale } = useT();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const pro = user.plan === "PREMIUM";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/billing/history", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((payload: { payments?: PaymentRow[] }) => setPayments(payload.payments ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function changePassword() {
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setMessage(
      result.error
        ? (result.error.message ?? t("billing.passwordFailed"))
        : t("billing.passwordChanged"),
    );
    if (!result.error) {
      setCurrentPassword("");
      setNewPassword("");
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-surface/40 p-4 sm:p-6">
      <h1 className="text-[22px] font-bold tracking-tight">{t("billing.title")}</h1>
      <p className="mt-1 text-[13px] text-muted">{t("billing.subtitle")}</p>

      <Reveal stagger className="mt-6 flex flex-col gap-4">
        {/* The plan banner, which is the one thing a reader opens this page to
            check. Pro carries the gradient; Free carries the way to it. */}
        <section
          className={`rounded-2xl border p-6 ${
            pro
              ? "border-accent-blue/40 bg-gradient-to-r from-accent-blue/25 via-accent-blue/10 to-surface"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center gap-2">
            <Crown className={`size-4 ${pro ? "text-accent-blue" : "text-warning"}`} />
            <h2 className="text-[14px] font-bold">{t("billing.proTitle")}</h2>
          </div>
          <p className="mt-2 text-[13px] text-muted">{t("billing.proPitch")}</p>
          <p className="mt-5 flex items-baseline gap-1.5">
            <span className="text-[30px] font-bold leading-none tracking-tight">
              {formatUsd(billingPlan("annual").perMonthUsd)}
            </span>
            <span className="text-[12px] font-medium text-muted-2">
              {t("billing.perMonthAnnual")}
            </span>
          </p>
          {pro ? (
            <p className="mt-4 text-[13px] font-semibold text-positive">{t("billing.proActive")}</p>
          ) : (
            <Link
              href="/pricing"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent-blue to-accent px-4 py-2.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
            >
              {t("billing.seePlans")}
            </Link>
          )}
        </section>

        <Card title={t("billing.profile")}>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t("auth.name")}>{user.name}</Field>
            <Field label={t("auth.email")}>
              {user.email} · {t(user.emailVerified ? "billing.verified" : "billing.unverified")}
            </Field>
            <Field label={t("billing.role")}>{user.role}</Field>
            <Field label={t("billing.plan")}>{user.plan}</Field>
          </dl>
        </Card>

        <Card title={t("billing.changePassword")}>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder={t("billing.currentPassword")}
              className="h-11 rounded-xl border border-border bg-surface-2 px-3.5 text-[13px] placeholder:text-muted-2 focus:border-accent-blue/60 focus:outline-none"
            />
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={t("billing.newPassword")}
              className="h-11 rounded-xl border border-border bg-surface-2 px-3.5 text-[13px] placeholder:text-muted-2 focus:border-accent-blue/60 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void changePassword()}
            disabled={!currentPassword || newPassword.length < 10}
            className="mt-3.5 rounded-xl border border-border bg-surface-3 px-4 py-2.5 text-[12.5px] font-bold transition-colors hover:border-border-strong disabled:opacity-40"
          >
            {t("billing.savePassword")}
          </button>
          {message && <p className="mt-2.5 text-[12px] text-muted">{message}</p>}
        </Card>

        <Card title={t("billing.history")}>
          {payments.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">{t("billing.noPayments")}</p>
          ) : (
            <div className="mt-3 divide-y divide-border">
              {payments.map((payment) => (
                <div key={payment.id} className="flex flex-wrap items-center gap-3 py-3 text-[12px]">
                  <span className="font-mono text-muted">{payment.orderId}</span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", {
                      style: "currency",
                      currency: payment.currency,
                      maximumFractionDigits: 0,
                    }).format(payment.amount)}
                  </span>
                  <span className="rounded-lg border border-border px-2.5 py-1 font-bold">
                    {payment.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Reveal>
    </div>
  );
}

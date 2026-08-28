"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Crown, Loader2, Minus, ShieldCheck } from "lucide-react";
import { PLAN_CAPABILITIES, PREMIUM_PERIOD_DAYS } from "@/core/domain/access/plan-catalog";
import type { SubscriptionPlan } from "@/core/domain/identity";
import type { ProviderCopy } from "@/core/domain/billing/provider-copy";

interface PricingModuleProps {
  priceIdr: number;
  authenticated: boolean;
  plan: SubscriptionPlan | null;
  periodEnd: string | null;
  provider: ProviderCopy;
}

const priceFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Renders a capability cell as either a quantity or a yes/no mark. */
function CapabilityValue({ value, strong }: { value: string | boolean; strong?: boolean }) {
  if (typeof value === "string") {
    return (
      <span className={`text-[12px] tabular-nums ${strong ? "font-semibold text-foreground" : "text-muted"}`}>
        {value}
      </span>
    );
  }
  return value ? (
    <Check className={`size-4 ${strong ? "text-accent-2" : "text-positive"}`} aria-label="Termasuk" />
  ) : (
    <Minus className="size-4 text-muted-2" aria-label="Tidak termasuk" />
  );
}

export function PricingModule({ priceIdr, authenticated, plan, periodEnd, provider }: PricingModuleProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPremium = plan === "PREMIUM";

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST" });
      const payload = (await response.json()) as {
        redirectUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.redirectUrl) {
        setError(payload.error?.message ?? "Checkout tidak dapat dibuat.");
        setLoading(false);
        return;
      }
      window.location.assign(payload.redirectUrl);
    } catch {
      setError("Checkout tidak dapat dibuat. Periksa koneksi Anda.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Pricing</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Satu paket berbayar, tanpa tingkatan tersembunyi. Seluruh analisis dihasilkan dari aturan
          teknikal terprogram, dan Coin Secret tidak mengeksekusi transaksi.
        </p>
      </header>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <section className="card flex flex-col p-6">
          <h2 className="text-sm font-bold">Free</h2>
          <p className="mt-1 text-xs text-muted">Untuk mengenal cara kerja zona dan setup.</p>
          <p className="mt-5 text-3xl font-bold tabular-nums">Rp0</p>
          <p className="mt-1 text-[11px] text-muted-2">Selamanya</p>
          <div className="mt-6">
            {authenticated ? (
              <p className="rounded-lg border border-border bg-surface-3 px-3 py-2.5 text-center text-xs font-semibold text-muted">
                {isPremium ? "Termasuk dalam Premium" : "Paket Anda saat ini"}
              </p>
            ) : (
              <Link
                href="/register"
                className="block rounded-lg border border-border px-4 py-2.5 text-center text-sm font-bold transition-colors hover:border-border-strong"
              >
                Daftar gratis
              </Link>
            )}
          </div>
        </section>

        <section className="card relative flex flex-col border-accent/40 p-6">
          <span className="absolute -top-2.5 left-6 rounded-full bg-gradient-to-r from-accent to-accent-blue px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Lengkap
          </span>
          <div className="flex items-center gap-2">
            <Crown className="size-4 text-warning" />
            <h2 className="text-sm font-bold">Premium</h2>
          </div>
          <p className="mt-1 text-xs text-muted">Scanner penuh, signals, dan kapasitas lebih besar.</p>
          <p className="mt-5 text-3xl font-bold tabular-nums">{priceFormatter.format(priceIdr)}</p>
          <p className="mt-1 text-[11px] text-muted-2">
            per {PREMIUM_PERIOD_DAYS} hari · tanpa perpanjangan otomatis
          </p>

          <div className="mt-6">
            {!authenticated ? (
              <Link
                href="/login?next=/pricing"
                className="block rounded-lg bg-gradient-to-r from-accent to-accent-blue px-4 py-2.5 text-center text-sm font-bold text-white transition-opacity hover:opacity-90"
              >
                Masuk untuk berlangganan
              </Link>
            ) : isPremium ? (
              <div className="rounded-lg border border-positive/30 bg-positive/10 px-3 py-2.5 text-center">
                <p className="text-xs font-bold text-positive">Premium aktif</p>
                {periodEnd && (
                  <p className="mt-0.5 text-[11px] text-muted">
                    Berlaku sampai {dateFormatter.format(new Date(periodEnd))}
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void checkout()}
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-blue px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {loading && <Loader2 className="size-4 animate-spin" />}
                Upgrade melalui {provider.name}
              </button>
            )}
            {error && <p className="mt-2 text-center text-[11px] text-negative">{error}</p>}
          </div>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-bold">Perbandingan lengkap</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[560px] text-left">
            <thead className="bg-surface-3">
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                <th scope="col" className="p-3">Kemampuan</th>
                <th scope="col" className="w-32 p-3">Free</th>
                <th scope="col" className="w-32 p-3">Premium</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_CAPABILITIES.map((capability) => (
                <tr key={capability.label} className="border-t border-border align-top">
                  <td className="p-3">
                    <p className="text-[12px] font-medium">{capability.label}</p>
                    {capability.hint && (
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-2">{capability.hint}</p>
                    )}
                  </td>
                  <td className="p-3">
                    <CapabilityValue value={capability.free} />
                  </td>
                  <td className="p-3">
                    <CapabilityValue value={capability.premium} strong />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card mt-6 flex gap-3 p-5">
        <ShieldCheck className="size-5 shrink-0 text-muted-2" />
        <div className="text-[12px] leading-relaxed text-muted">
          <p className="font-semibold text-foreground">Yang perlu Anda ketahui sebelum membayar</p>
          <ul className="mt-2 space-y-1.5">
            <li>
              {provider.assurance}
            </li>
            <li>
              Premium berlaku {PREMIUM_PERIOD_DAYS} hari dan <strong>tidak</strong> diperpanjang
              otomatis. Tidak ada tagihan berulang.
            </li>
            <li>
              Setelah masa aktif berakhir, akun kembali ke Free. Riwayat pembayaran
              dan data akun Anda tetap tersimpan.
            </li>
            <li>
              Coin Secret adalah alat analisis teknikal berbasis aturan. Ini bukan nasihat
              investasi, dan tidak ada hasil yang dijamin.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

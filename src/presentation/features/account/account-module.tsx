"use client";

import { useEffect, useState } from "react";
import { Crown, Loader2 } from "lucide-react";
import type { CurrentUserDto } from "@/core/domain/identity";
import { authClient } from "@/infrastructure/auth/auth-client";
import type { ProviderCopy } from "@/core/domain/billing/provider-copy";

export function AccountModule({ user, premiumPriceIdr, provider }: { user: CurrentUserDto; premiumPriceIdr: number; provider: ProviderCopy }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function checkout() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/billing/checkout", { method: "POST" });
    const payload = await response.json() as { redirectUrl?: string; error?: { message?: string } };
    if (!response.ok || !payload.redirectUrl) {
      setLoading(false);
      setError(payload.error?.message ?? "Checkout tidak dapat dibuat.");
      return;
    }
    window.location.assign(payload.redirectUrl);
  }

  async function changePassword() {
    const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setAccountMessage(result.error ? (result.error.message ?? "Password gagal diubah.") : "Password berhasil diubah.");
    if (!result.error) { setCurrentPassword(""); setNewPassword(""); }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
      <div><h1 className="text-xl font-bold">Akun & Billing</h1><p className="mt-1 text-sm text-muted">Kelola identitas dan paket Coin Secret.</p></div>
      <section className="card p-5"><h2 className="text-sm font-bold">Profil</h2><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted">Nama</dt><dd className="mt-1 font-semibold">{user.name}</dd></div><div><dt className="text-xs text-muted">Email</dt><dd className="mt-1 font-semibold">{user.email} · {user.emailVerified ? "Terverifikasi" : "Belum terverifikasi"}</dd></div><div><dt className="text-xs text-muted">Role</dt><dd className="mt-1 font-semibold">{user.role}</dd></div><div><dt className="text-xs text-muted">Paket</dt><dd className="mt-1 font-semibold">{user.plan}</dd></div></dl></section>
      <section className="card p-5"><h2 className="text-sm font-bold">Ubah Password</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Password saat ini" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" /><input type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Password baru" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div><button onClick={() => void changePassword()} disabled={!currentPassword || newPassword.length < 10} className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-40">Simpan password</button>{accountMessage && <p className="mt-2 text-xs text-muted">{accountMessage}</p>}</section>
      <section className="card p-5"><div className="flex items-center gap-2"><Crown className="size-5 text-warning" /><h2 className="text-sm font-bold">Coin Secret Premium</h2></div><p className="mt-2 text-sm text-muted">Akses scanner penuh dan seluruh signals di semua simbol selama 30 hari.</p><p className="mt-4 text-2xl font-bold">{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(premiumPriceIdr)} <span className="text-xs font-normal text-muted">/ 30 hari</span></p>{user.plan === "PREMIUM" ? <p className="mt-4 text-sm font-semibold text-positive">Premium aktif.</p> : <button onClick={checkout} disabled={loading} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-blue px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{loading && <Loader2 className="size-4 animate-spin" />}Upgrade melalui {provider.name}</button>}{error && <p className="mt-3 text-xs text-negative">{error}</p>}</section>
      <section className="card p-5"><h2 className="text-sm font-bold">Riwayat Pembayaran</h2>{payments.length === 0 ? <p className="mt-3 text-sm text-muted">Belum ada pembayaran.</p> : <div className="mt-3 divide-y divide-border">{payments.map((payment) => <div key={payment.id} className="flex flex-wrap items-center gap-3 py-3 text-xs"><span className="font-mono text-muted">{payment.orderId}</span><span className="ml-auto font-semibold">{new Intl.NumberFormat("id-ID", { style: "currency", currency: payment.currency, maximumFractionDigits: 0 }).format(payment.amount)}</span><span className="rounded-md border border-border px-2 py-1 font-bold">{payment.status}</span></div>)}</div>}</section>
    </div>
  );
}

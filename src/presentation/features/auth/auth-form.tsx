"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authClient, notifyAuthStateChanged } from "@/infrastructure/auth/auth-client";
import { safeRedirectPath } from "@/shared/lib/safe-redirect";
import { BrandLockup, BRAND_NAME } from "@/presentation/ui/brand-logo";
import { useT } from "@/presentation/hooks/use-translate";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = mode === "register"
      ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
      : await authClient.signIn.email({ email: email.trim(), password });
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? t("auth.failed"));
      return;
    }
    notifyAuthStateChanged();
    router.replace(safeRedirectPath(params.get("next")));
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <Link href="/" className="mb-6 flex items-center justify-center" aria-label={BRAND_NAME}>
          <BrandLockup height={34} />
        </Link>
        <h1 className="text-xl font-bold">{t(mode === "login" ? "auth.signInTitle" : "auth.signUpTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t(mode === "login" ? "auth.signInBlurb" : "auth.signUpBlurb")}</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && <label className="block text-xs font-semibold">{t("auth.name")}<input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-accent/60 focus:outline-none" /></label>}
          <label className="block text-xs font-semibold">{t("auth.email")}<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-accent/60 focus:outline-none" /></label>
          <label className="block text-xs font-semibold">{t("auth.password")}<input required type="password" minLength={10} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-accent/60 focus:outline-none" /></label>
          {mode === "login" && <Link href="/forgot-password" className="block text-right text-xs font-semibold text-accent-2">{t("auth.forgotPassword")}</Link>}
          {error && <p role="alert" className="rounded-lg border border-negative/30 bg-negative/10 p-3 text-xs text-negative">{error}</p>}
          <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-blue py-2.5 text-sm font-bold text-white disabled:opacity-60">{loading && <Loader2 className="size-4 animate-spin" />}{t(mode === "login" ? "account.signIn" : "account.signUp")}</button>
        </form>
        <p className="mt-5 text-center text-xs text-muted">{t(mode === "login" ? "auth.noAccount" : "auth.haveAccount")} <Link className="font-semibold text-accent-2 hover:underline" href={mode === "login" ? "/register" : "/login"}>{t(mode === "login" ? "account.signUp" : "account.signIn")}</Link></p>
      </div>
    </main>
  );
}

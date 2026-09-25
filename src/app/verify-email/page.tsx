"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";
import { useT } from "@/presentation/hooks/use-translate";

function VerificationForm() {
  const params = useSearchParams();
  const { t } = useT();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError(true);
      return;
    }
    setPending(true);
    setError(false);
    try {
      const result = await authClient.emailOtp.verifyEmail({ email: email.trim(), otp: code });
      if (result.error) setError(true);
      else setDone(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setPending(true);
    setError(false);
    setNotice(false);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "email-verification" });
      if (result.error) setError(true);
      else setNotice(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-xl font-bold">{t("auth.verifyTitle")}</h1>
        {done ? (
          <>
            <p className="mt-4 text-sm text-positive" role="status">{t("auth.verifySuccess")}</p>
            <Link href="/login" className="mt-5 block rounded-lg bg-accent py-2.5 text-center text-sm font-bold text-white">
              {t("account.signIn")}
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">{t("auth.verifyCodeHelp")}</p>
            {error && <p className="mt-3 text-sm text-negative" role="alert">{t("auth.verifyCodeError")}</p>}
            {notice && <p className="mt-3 text-sm text-positive" role="status">{t("auth.codeSent")}</p>}
            <form onSubmit={verify} className="mt-5 space-y-4">
              <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("auth.email")} aria-label={t("auth.email")} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm" />
              <input
                required
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("auth.verifyCodePlaceholder")}
                aria-label={t("auth.verifyCodePlaceholder")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              />
              <button type="submit" disabled={pending} className="w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-60">
                {t("auth.verifySubmit")}
              </button>
            </form>
            <button type="button" onClick={() => void resend()} disabled={pending || !email.includes("@")} className="mt-4 w-full text-sm text-accent-2 disabled:opacity-50">{t("auth.resendCode")}</button>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return <Suspense><VerificationForm /></Suspense>;
}

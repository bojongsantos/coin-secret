"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient, notifyAuthStateChanged } from "@/infrastructure/auth/auth-client";
import { useT } from "@/presentation/hooks/use-translate";
import { PasswordField } from "@/presentation/ui/password-field";

export function PasswordRecoveryForm({ mode }: { mode: "request" | "reset" }) {
  const router = useRouter();
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (countdown === null) return;
    const timer = window.setTimeout(() => {
      if (countdown <= 1) router.replace("/login");
      else setCountdown(countdown - 1);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [countdown, router]);

  async function sendCode() {
    if (inFlight.current || cooldown > 0) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await authClient.emailOtp.requestPasswordReset({ email: email.trim().toLowerCase() });
      if (result.error) {
        setError(result.error.message ?? t("recovery.requestFailed"));
        if (result.error.status === 429) setCooldown(60);
      } else {
        setEmail(email.trim().toLowerCase());
        setCode("");
        setSent(true);
        setCooldown(60);
        setMessage(t("recovery.linkSent"));
      }
    } catch {
      setError(t("recovery.requestFailed"));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!sent) return sendCode();
    if (inFlight.current) return;
    setError(null);
    setMessage(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t("recovery.badToken"));
      return;
    }
    if (password !== confirmation) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      const result = await authClient.emailOtp.resetPassword({ email, otp: code, password });
      if (result.error) {
        setError(result.error.message ?? t("billing.passwordFailed"));
        return;
      }
      setPassword("");
      setConfirmation("");
      setCode("");
      notifyAuthStateChanged();
      setMessage(t("billing.passwordChanged"));
      setCountdown(3);
    } catch {
      setError(t("recovery.requestFailed"));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const done = countdown !== null;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div className="animate-pop w-full max-w-md rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-xl font-bold">{t(sent || mode === "reset" ? "recovery.resetTitle" : "recovery.forgotTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t(sent ? "recovery.resetBlurb" : "recovery.forgotBlurb")}</p>
        {done ? (
          <div className="mt-6 space-y-2" role="status" aria-live="polite">
            <p className="text-sm font-semibold text-positive">{message}</p>
            <p className="text-xs text-muted">{t("recovery.redirecting", { seconds: countdown ?? 0 })}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <input required type="email" aria-label={t("auth.email")} autoComplete="email" readOnly={sent} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm" />
            {sent && (
              <>
                <input required type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={t("recovery.codePlaceholder")} aria-label={t("recovery.codePlaceholder")} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm" />
                <PasswordField required autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("billing.newPassword")} aria-label={t("billing.newPassword")} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm" />
                <PasswordField required autoComplete="new-password" minLength={10} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={t("auth.confirmPassword")} aria-label={t("auth.confirmPassword")} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm" />
              </>
            )}
            {error && <p role="alert" className="text-xs text-negative">{error}</p>}
            {message && <p role="status" className="text-xs text-positive">{message}</p>}
            <button type="submit" disabled={pending || (!sent && cooldown > 0)} className="w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-60">{t(sent ? "billing.savePassword" : "recovery.sendLink")}</button>
            {sent && (
              <div className="flex justify-between gap-3 text-xs text-accent-2">
                <button type="button" disabled={pending || cooldown > 0} onClick={() => void sendCode()} className="disabled:opacity-50">{cooldown > 0 ? t("recovery.resendWait", { seconds: cooldown }) : t("auth.resendCode")}</button>
                <button type="button" disabled={pending} onClick={() => { setSent(false); setPassword(""); setConfirmation(""); setCode(""); setMessage(null); setError(null); }}>{t("recovery.changeEmail")}</button>
              </div>
            )}
          </form>
        )}
        <Link href="/login" className="mt-5 block text-center text-xs font-semibold text-accent-2">{t("recovery.backToLogin")}</Link>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";
import { useT } from "@/presentation/hooks/use-translate";

/**
 * Seconds the confirmation stays on screen before the login page takes over.
 *
 * Long enough to read that the password actually changed, short enough that
 * nobody wonders whether they still have to do something. Zero would be worse
 * than a click: the page would vanish mid-sentence and leave the reader unsure
 * whether it worked.
 */
const REDIRECT_SECONDS = 3;

export function PasswordRecoveryForm({ mode }: { mode: "request" | "reset" }) {
  const params = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const { t } = useT();
  const [error, setError] = useState<string | null>(params.get("error"));
  const [pending, setPending] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Counts down, then leaves. `replace` rather than `push` because the reset
  // token is spent: going Back would land on a form that can only fail.
  useEffect(() => {
    if (countdown === null) return;
    const timer = window.setTimeout(() => {
      // Leave on the tick after "1 detik" rather than rendering a zero the
      // reader would only see while the page is already navigating away.
      if (countdown <= 1) router.replace("/login");
      else setCountdown(countdown - 1);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [countdown, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === "request") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (result.error) setError(result.error.message ?? t("recovery.requestFailed"));
        // Worded the same whether or not the address exists, so the form
        // cannot be used to discover who has an account here.
        else setMessage(t("recovery.linkSent"));
        return;
      }

      const token = params.get("token");
      if (!token) {
        setError(t("recovery.badToken"));
        return;
      }
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(result.error.message ?? t("billing.passwordFailed"));
        return;
      }
      setMessage(t("billing.passwordChanged"));
      setCountdown(REDIRECT_SECONDS);
    } finally {
      setPending(false);
    }
  }

  // Once the reset lands, the form has nothing left to do and the session is
  // gone. Leaving the fields on screen would invite a second submit against a
  // token the server has already spent.
  const done = countdown !== null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-xl font-bold">
          {t(mode === "request" ? "recovery.forgotTitle" : "recovery.resetTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {t(mode === "request" ? "recovery.forgotBlurb" : "recovery.resetBlurb")}
        </p>

        {done ? (
          <div className="mt-6 space-y-2" role="status" aria-live="polite">
            <p className="text-sm font-semibold text-positive">{message}</p>
            <p className="text-xs text-muted">
              {t("recovery.redirecting", { seconds: countdown ?? 0 })}
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "request" ? (
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              />
            ) : (
              <input
                required
                type="password"
                minLength={10}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("billing.newPassword")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              />
            )}
            {error && <p className="text-xs text-negative">{error}</p>}
            {message && <p className="text-xs text-positive">{message}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {t(mode === "request" ? "recovery.sendLink" : "billing.savePassword")}
            </button>
          </form>
        )}

        <Link href="/login" className="mt-5 block text-center text-xs font-semibold text-accent-2">
          {t("recovery.backToLogin")}
        </Link>
      </div>
    </main>
  );
}

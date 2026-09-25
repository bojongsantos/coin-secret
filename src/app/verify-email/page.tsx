"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/presentation/hooks/use-translate";

function VerificationForm() {
  const params = useSearchParams();
  const { t } = useT();
  const error = params.get("error");
  const done = params.get("done") === "1" && !error;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-xl font-bold">{t("auth.verifyTitle")}</h1>
        {done ? (
          <>
            <p className="mt-4 text-sm text-positive" role="status">{t("auth.verifySuccess")}</p>
            <Link href="/dashboard" className="mt-5 block rounded-lg bg-accent py-2.5 text-center text-sm font-bold text-white">
              {t("nav.dashboard")}
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">{t("auth.verifyCodeHelp")}</p>
            {error && <p className="mt-3 text-sm text-negative" role="alert">{t("auth.verifyCodeError")}</p>}
            <form method="get" action="/api/auth/verify-email" className="mt-5 space-y-4">
              <input type="hidden" name="callbackURL" value="/verify-email?done=1" />
              <input
                required
                type="text"
                name="token"
                autoComplete="one-time-code"
                placeholder={t("auth.verifyCodePlaceholder")}
                aria-label={t("auth.verifyCodePlaceholder")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              />
              <button type="submit" className="w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-white">
                {t("auth.verifySubmit")}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return <Suspense><VerificationForm /></Suspense>;
}

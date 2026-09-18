"use client";

import Link from "next/link";
import { CandlestickChart, Loader2, Lock } from "lucide-react";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { useT } from "@/presentation/hooks/use-translate";
import { useSdScan } from "@/presentation/hooks/use-scanner";
import { AppShell } from "@/presentation/layout/app-shell";
import { SignalsBoard } from "@/presentation/features/signals/signals-board";
import { Reveal } from "@/presentation/ui/reveal";

function UnlockedSignals() {
  const { result, loading, error, failedCount, refresh } = useSdScan();

  return (
    <>
      {!result && loading ? (
        <div className="flex h-72 items-center justify-center text-muted-2">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <Reveal>
          <SignalsBoard
            demand={result?.demand ?? []}
            supply={result?.supply ?? []}
            demandTotal={result?.demandTotal ?? 0}
            supplyTotal={result?.supplyTotal ?? 0}
            loading={loading}
            error={error}
            onRefresh={refresh}
            failedCount={failedCount}
          />
        </Reveal>
      )}
    </>
  );
}

export function SignalsClient() {
  const { canAccess } = usePlan();
  const { t } = useT();

  return (
    <AppShell>
      {canAccess("signals") ? <UnlockedSignals /> : (
        <Reveal className="relative">
          {/* Decorative shapes only: protected market rows are never loaded
              to create the blurred background of the Free plan screen. */}
          <div className="cs-lock-preview pointer-events-none select-none p-5" aria-hidden="true">
            <div className="mb-8 flex items-center gap-3 text-2xl">
              <CandlestickChart className="text-accent-blue" /> {t("nav.signals")}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1].map((column) => (
                <div key={column} className="cs-card p-5">
                  {Array.from({ length: 14 }, (_, row) => <div key={row} className="cs-lock-preview-row" />)}
                </div>
              ))}
            </div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <section className="cs-card flex w-full max-w-[516px] flex-col items-center px-6 py-9 text-center shadow-2xl">
              <span className="mb-5 flex size-14 items-center justify-center rounded-full border border-muted text-foreground">
                <Lock className="size-7" aria-hidden />
              </span>
              <h1 className="cs-heading-gradient text-[34px] font-bold tracking-tight">{t("signals.locked")}</h1>
              <p className="mt-2 text-xs text-muted">{t("signals.lockedBody")}</p>
              <Link href="/pricing" className="cs-primary mt-6 inline-flex items-center gap-2 rounded-full px-8 py-2.5 text-sm font-semibold text-white">
                <Lock className="size-4" aria-hidden /> {t("common.unlockPro")}
              </Link>
            </section>
          </div>
        </Reveal>
      )}
    </AppShell>
  );
}

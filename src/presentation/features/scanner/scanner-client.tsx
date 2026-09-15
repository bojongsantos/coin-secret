"use client";

import { ScannerView } from "@/presentation/features/scanner/scanner-view";
import { useScanner } from "@/presentation/hooks/use-scanner";
import { useT } from "@/presentation/hooks/use-translate";
import { AppShell } from "@/presentation/layout/app-shell";
import { Reveal } from "@/presentation/ui/reveal";

export function ScannerClient() {
  const { opportunities, total, loading, error, refresh } = useScanner();
  const { t } = useT();

  return (
    <AppShell>
      <Reveal stagger className="flex flex-col gap-6 p-3 sm:p-6">
        <div>
          <h1 className="text-lg font-bold tracking-tight">{t("scanner.title")}</h1>
          <p className="mt-0.5 text-[12px] text-muted">{t("scanner.subtitle")}</p>
        </div>
        {error && (
          <div className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-[12px] text-negative">
            {error}
          </div>
        )}
        <ScannerView data={opportunities} total={total} loading={loading} onRun={refresh} />
      </Reveal>
    </AppShell>
  );
}

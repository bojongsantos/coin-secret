"use client";

import { ScannerView } from "@/presentation/features/scanner/scanner-view";
import { useScanner } from "@/presentation/hooks/use-scanner";
import { AppShell } from "@/presentation/layout/app-shell";

export function ScannerClient() {
  const { opportunities, total, loading, error, refresh } = useScanner();

  return (
    <AppShell opportunities={opportunities}>
      <div className="flex flex-col gap-6 p-3 sm:p-6">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Market Scanner</h1>
          <p className="mt-0.5 text-[12px] text-muted">
            Setup live diurutkan berdasarkan confidence di seluruh papan.
          </p>
        </div>
        {error && (
          <div className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-[12px] text-negative">
            {error}
          </div>
        )}
        <ScannerView data={opportunities} total={total} loading={loading} onRun={refresh} />
      </div>
    </AppShell>
  );
}

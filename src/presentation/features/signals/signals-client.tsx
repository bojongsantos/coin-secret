"use client";

import { Loader2 } from "lucide-react";
import { useSdScan } from "@/presentation/hooks/use-scanner";
import { AppShell } from "@/presentation/layout/app-shell";
import { SignalsBoard } from "@/presentation/features/signals/signals-board";
import { Reveal } from "@/presentation/ui/reveal";

export function SignalsClient() {
  const { result, loading, error, failedCount, refresh } = useSdScan();

  return (
    <AppShell>
      {!result && loading ? (
        <div className="flex h-72 items-center justify-center text-muted-2">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <Reveal>
          <SignalsBoard
            demand={result?.demand ?? []}
            supply={result?.supply ?? []}
            loading={loading}
            error={error}
            onRefresh={refresh}
            failedCount={failedCount}
          />
        </Reveal>
      )}
    </AppShell>
  );
}

"use client";

import { useEffect } from "react";
import { useT } from "@/presentation/hooks/use-translate";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { t } = useT();
  useEffect(() => {
    console.error("Coin Secret route error", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="card max-w-md p-6 text-center">
        <p className="text-sm font-bold">{t("error.pageFailed")}</p>
        <p className="mt-2 text-xs text-muted">{t("error.pageFailedBody")}</p>
        {error.digest && (
          <p className="mt-2 text-[10px] text-muted-2">
            {t("error.reference", { digest: error.digest })}
          </p>
        )}
        <button
          type="button"
          onClick={retry}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white"
        >
          {t("common.retry")}
        </button>
      </section>
    </main>
  );
}

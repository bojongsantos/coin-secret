"use client";

import Link from "next/link";
import { useT } from "@/presentation/hooks/use-translate";

export default function NotFound() {
  const { t } = useT();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="card max-w-md p-6 text-center">
        <p className="text-3xl font-bold">404</p>
        <h1 className="mt-2 text-sm font-semibold">{t("error.notFound")}</h1>
        <p className="mt-2 text-xs text-muted">{t("error.notFoundBody")}</p>
        <Link href="/" className="mt-4 inline-flex rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white">
          {t("error.backHome")}
        </Link>
      </section>
    </main>
  );
}

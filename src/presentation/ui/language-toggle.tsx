"use client";

import { Languages } from "lucide-react";
import { useLocale } from "@/presentation/hooks/use-ui-preference";
import { translate } from "@/shared/i18n/messages";
import { oppositeLocale } from "@/shared/lib/ui-preferences";

/**
 * Switches the interface between Indonesian and English.
 *
 * The button shows the language currently in use and offers the other one, in
 * that other language: an English reader who cannot read the interface can
 * still read "Switch to English" and find their way out.
 */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const next = oppositeLocale(locale);
  const label = translate(locale, "language.switchTo");

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      title={label}
      aria-label={label}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-3 px-2.5 text-[11px] font-bold text-muted transition-colors hover:border-border-strong hover:text-foreground ${className}`}
    >
      <Languages className="size-4" />
      {locale.toUpperCase()}
    </button>
  );
}

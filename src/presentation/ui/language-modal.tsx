"use client";

import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import { useLocale } from "@/presentation/hooks/use-ui-preference";
import { useT } from "@/presentation/hooks/use-translate";
import { LOCALES, type Locale } from "@/core/domain/i18n/locale";

/**
 * The languages offered, and how each names itself.
 *
 * A language is written in its own language — someone looking for Indonesian
 * is looking for "Bahasa Indonesia", not for "Indonesian" — so these are not
 * translated strings and do not belong in the message table.
 */
const LANGUAGE_NAMES: Record<Locale, { name: string; code: string }> = {
  en: { name: "English", code: "US" },
  id: { name: "Bahasa Indonesia", code: "ID" },
};

/**
 * The language picker.
 *
 * Only the languages the product actually speaks are listed. The design sketched
 * eight; offering six that do nothing would be a promise the app cannot keep,
 * and the reader finds that out by clicking one.
 */
export function LanguageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, setLocale } = useLocale();
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("language.title")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      // A click that starts and ends on the backdrop closes; one that merely
      // ends there — a drag out of the panel — does not.
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg rounded-3xl border border-border bg-surface p-6 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[20px] font-bold tracking-tight">{t("language.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-lg p-1 text-muted-2 transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
          {LOCALES.map((option) => {
            const active = option === locale;
            const { name, code } = LANGUAGE_NAMES[option];
            return (
              <button
                key={option}
                type="button"
                lang={option}
                aria-pressed={active}
                onClick={() => {
                  setLocale(option);
                  onClose();
                }}
                className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                  active
                    ? "border-border-strong bg-surface-3"
                    : "border-transparent bg-surface-2 hover:bg-surface-3/70"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-foreground">{name}</span>
                  <span className="mt-0.5 block text-[12px] text-muted-2">{code}</span>
                </span>
                {active && (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-positive">
                    <Check className="size-3 text-positive" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

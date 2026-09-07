"use client";

import { useCallback } from "react";
import { useLocale } from "@/presentation/hooks/use-ui-preference";
import { translate, type MessageKey } from "@/shared/i18n/messages";

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * The interface's own language, and the function that speaks it.
 *
 * Read from the root element like every other viewing preference, so a
 * language chosen on a previous visit is already in place before React runs
 * and no component ever renders the wrong one first.
 */
export function useT(): { t: Translate; locale: ReturnType<typeof useLocale>["locale"] } {
  const { locale } = useLocale();
  const t = useCallback<Translate>((key, vars) => translate(locale, key, vars), [locale]);
  return { t, locale };
}

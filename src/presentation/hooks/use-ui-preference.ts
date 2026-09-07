"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_LOCALE,
  DEFAULT_SIDEBAR,
  DEFAULT_THEME,
  LOCALE_ATTRIBUTE,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  normalizeSidebar,
  normalizeTheme,
  PREFERENCE_EVENT,
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_STORAGE_KEY,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  type Locale,
  type SidebarState,
  type Theme,
} from "@/shared/lib/ui-preferences";

/**
 * Reads a preference straight from the root element.
 *
 * `useSyncExternalStore` rather than state synchronised in an effect: the
 * attribute is already correct before React runs, so copying it into state
 * would only create a render where the two disagree.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(PREFERENCE_EVENT, onChange);
  // Fired by other tabs only, which is exactly the case local state misses.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(attribute: string, storageKey: string, value: string): void {
  document.documentElement.setAttribute(attribute, value);
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Storage can be blocked outright. The choice still applies to this page;
    // it simply will not survive a reload, which beats throwing at the click.
  }
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(
    subscribe,
    () => normalizeTheme(document.documentElement.getAttribute(THEME_ATTRIBUTE)),
    () => DEFAULT_THEME,
  );
  const setTheme = useCallback((next: Theme) => {
    write(THEME_ATTRIBUTE, THEME_STORAGE_KEY, next);
  }, []);
  return { theme, setTheme };
}

export function useSidebarState(): {
  sidebar: SidebarState;
  setSidebar: (state: SidebarState) => void;
} {
  const sidebar = useSyncExternalStore(
    subscribe,
    () => normalizeSidebar(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE)),
    () => DEFAULT_SIDEBAR,
  );
  const setSidebar = useCallback((next: SidebarState) => {
    write(SIDEBAR_ATTRIBUTE, SIDEBAR_STORAGE_KEY, next);
  }, []);
  return { sidebar, setSidebar };
}

export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const locale = useSyncExternalStore(
    subscribe,
    () => normalizeLocale(document.documentElement.getAttribute(LOCALE_ATTRIBUTE)),
    // The server renders the default; the inline preference script has already
    // corrected the attribute by the time the browser reads it back.
    () => DEFAULT_LOCALE,
  );
  const setLocale = useCallback((next: Locale) => {
    write(LOCALE_ATTRIBUTE, LOCALE_STORAGE_KEY, next);
  }, []);
  return { locale, setLocale };
}

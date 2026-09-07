/**
 * Viewing preferences that must be settled before the first paint.
 *
 * Both live as attributes on the root element rather than in React state. A
 * preference restored during hydration arrives one paint too late: the reader
 * sees a dark page flash white, or the sidebar spring open and snap shut. The
 * inline script below stamps the attributes before anything renders, and React
 * reads them back rather than owning them.
 */

export type Theme = "dark" | "light";
export type SidebarState = "expanded" | "collapsed";
// Re-exported so a component reads every viewing preference from one module,
// while the language itself stays a domain idea: the analysis engine writes in
// it and cannot depend on anything up here.
export {
  DEFAULT_LOCALE,
  isLocale,
  normalizeLocale,
  oppositeLocale,
  type Locale,
} from "@/core/domain/i18n/locale";
import { DEFAULT_LOCALE } from "@/core/domain/i18n/locale";

export const THEME_STORAGE_KEY = "coinsecret:theme";
export const SIDEBAR_STORAGE_KEY = "coinsecret:sidebar";
export const LOCALE_STORAGE_KEY = "coinsecret:locale";

export const THEME_ATTRIBUTE = "data-theme";
export const SIDEBAR_ATTRIBUTE = "data-sidebar";
/**
 * The language lives in the standard `lang` attribute rather than a data one.
 *
 * It is what a screen reader picks its pronunciation from and what the browser
 * offers to translate against, so a private attribute would leave both of them
 * reading Indonesian copy as English. One attribute, both jobs.
 */
export const LOCALE_ATTRIBUTE = "lang";

/**
 * Dark is the default rather than the system setting.
 *
 * The product has always been dark, the chart palette is built for it, and a
 * reader whose OS is light did not ask for the whole app to change appearance
 * the day a toggle shipped. The toggle is the opt-in.
 */
export const DEFAULT_THEME: Theme = "dark";
export const DEFAULT_SIDEBAR: SidebarState = "expanded";

/** Fired on the window when a preference changes, so open views re-read it. */
export const PREFERENCE_EVENT = "coin-secret:preference-changed";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

export function isSidebarState(value: unknown): value is SidebarState {
  return value === "expanded" || value === "collapsed";
}

/** A stored value, or the default when it is absent or has been tampered with. */
export function normalizeTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function normalizeSidebar(value: unknown): SidebarState {
  return isSidebarState(value) ? value : DEFAULT_SIDEBAR;
}

export function oppositeTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function toggledSidebar(state: SidebarState): SidebarState {
  return state === "expanded" ? "collapsed" : "expanded";
}

/**
 * The script that runs before the first paint.
 *
 * Deliberately tiny and dependency-free because it blocks rendering, and
 * wrapped in try/catch because reading `localStorage` throws outright when a
 * browser blocks storage — a page that refuses to render is a far worse
 * outcome than a page that opens in the default theme.
 */
export function preferencesScript(): string {
  return `(function(){try{var d=document.documentElement;var t=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )});d.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t==="light"||t==="dark"?t:${JSON.stringify(
    DEFAULT_THEME,
  )});var s=localStorage.getItem(${JSON.stringify(
    SIDEBAR_STORAGE_KEY,
  )});d.setAttribute(${JSON.stringify(
    SIDEBAR_ATTRIBUTE,
  )},s==="collapsed"||s==="expanded"?s:${JSON.stringify(
    DEFAULT_SIDEBAR,
  )});var l=localStorage.getItem(${JSON.stringify(
    LOCALE_STORAGE_KEY,
  )});d.setAttribute(${JSON.stringify(
    LOCALE_ATTRIBUTE,
  )},l==="en"||l==="id"?l:${JSON.stringify(DEFAULT_LOCALE)});}catch(e){}})()`;
}

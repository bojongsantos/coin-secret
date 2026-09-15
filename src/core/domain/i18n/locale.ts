/**
 * The languages the product speaks.
 *
 * Owned by the domain rather than by the presentation layer because the
 * analysis text is written here: the engine has to know which language it is
 * writing a sentence in, and it cannot reach up into the UI to ask.
 */
export type Locale = "id" | "en";

export const LOCALES: readonly Locale[] = ["id", "en"];

/**
 * English is the default.
 *
 * The product is sold to a market that reads English, and the redesign is
 * drawn in it; Indonesian is the one a reader chooses. Reading the browser's
 * language instead would make the first paint unpredictable, and the language
 * is settled before the first paint on purpose.
 */
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return value === "id" || value === "en";
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function oppositeLocale(locale: Locale): Locale {
  return locale === "id" ? "en" : "id";
}

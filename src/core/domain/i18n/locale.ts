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
 * Indonesian is the default.
 *
 * The product was written in it and its readers are here; English is the
 * addition. Defaulting to the browser's language instead would change the app
 * under everyone who already uses it, to no one's request.
 */
export const DEFAULT_LOCALE: Locale = "id";

export function isLocale(value: unknown): value is Locale {
  return value === "id" || value === "en";
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function oppositeLocale(locale: Locale): Locale {
  return locale === "id" ? "en" : "id";
}

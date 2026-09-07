"use client";

import { LOCALE_STORAGE_KEY } from "@/shared/lib/ui-preferences";

/**
 * The last-resort boundary: it replaces the root layout, so nothing it needs
 * can be assumed to have loaded. The language is read straight from storage
 * rather than through the app's own hook, and a failure to read it simply
 * leaves the page in Indonesian.
 */
function storedLocale(): "id" | "en" {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY) === "en" ? "en" : "id";
  } catch {
    return "id";
  }
}

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const locale = storedLocale();
  const copy = {
    id: { title: "Coin Secret mengalami gangguan.", body: "Muat ulang aplikasi untuk mencoba pemulihan.", action: "Muat ulang" },
    en: { title: "Coin Secret has run into trouble.", body: "Reload the app to try to recover.", action: "Reload" },
  }[locale];
  return (
    <html lang={locale}>
      <body style={{ margin: 0, background: "#080b12", color: "#f4f7ff", fontFamily: "sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ maxWidth: 440, textAlign: "center" }}>
            <h1 style={{ fontSize: 20 }}>{copy.title}</h1>
            <p style={{ color: "#9ca3af", fontSize: 13 }}>{copy.body}</p>
            <button
              type="button"
              onClick={retry}
              style={{ marginTop: 12, border: 0, borderRadius: 8, padding: "9px 16px", background: "#5b67f1", color: "white" }}
            >
              {copy.action}
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}

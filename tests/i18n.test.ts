import test from "node:test";
import assert from "node:assert/strict";
import { MESSAGES, translate, statusMessageKey, domainMessageKey } from "@/shared/i18n/messages";
import { REASONING_COPY, say } from "@/core/domain/analysis/reasoning-copy";
import { buildReasoning } from "@/core/domain/analysis/analysis-engine";
import { LOCALES, normalizeLocale, oppositeLocale, DEFAULT_LOCALE } from "@/core/domain/i18n/locale";
import { featureLabel, type FeatureKey } from "@/core/domain/access/gating";
import { ACTIVE_SETUP_STATUSES, TERMINAL_SETUP_STATUSES } from "@/core/domain/analysis/setup-lifecycle";
import { preferencesScript, normalizeLocale as normalizeFromPreferences } from "@/shared/lib/ui-preferences";
import type { Candle } from "@/core/domain/models";

/** `{name}` markers in a phrase, as a set, so order does not matter. */
function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

function entries(table: Record<string, Record<string, string>>): Array<[string, Record<string, string>]> {
  return Object.entries(table);
}

for (const [name, table] of [
  ["interface", MESSAGES as unknown as Record<string, Record<string, string>>],
  ["analysis", REASONING_COPY as unknown as Record<string, Record<string, string>>],
] as const) {
  test(`every ${name} phrase exists in both languages`, () => {
    const rows = entries(table);
    assert.ok(rows.length > 0, "the table is not empty");
    for (const [key, pair] of rows) {
      for (const locale of LOCALES) {
        const text = pair[locale];
        assert.equal(typeof text, "string", `${key} has no ${locale}`);
        assert.ok(text.trim().length > 0, `${key} is empty in ${locale}`);
        assert.equal(text, text.trim(), `${key} has stray whitespace in ${locale}`);
      }
    }
  });

  test(`every ${name} phrase keeps its numbers in both languages`, () => {
    // The failure this pins is the quiet one: a translated sentence that
    // dropped a `{price}` still reads as a sentence, so nothing looks broken —
    // the reader is simply shown a claim with the number missing.
    for (const [key, pair] of entries(table)) {
      assert.deepEqual(
        [...placeholders(pair.en)].sort(),
        [...placeholders(pair.id)].sort(),
        `${key} does not carry the same values in both languages`,
      );
    }
  });
}

test("a translated phrase is a different sentence, not the same one twice", () => {
  // Some phrases are legitimately identical across languages — "Dashboard",
  // "Momentum", a price format. Most are not, and a table where nearly
  // everything matches means one language was pasted over the other.
  const rows = entries(MESSAGES as unknown as Record<string, Record<string, string>>);
  const identical = rows.filter(([, pair]) => pair.en === pair.id);
  assert.ok(
    identical.length < rows.length / 2,
    `${identical.length} of ${rows.length} interface phrases are identical in both languages`,
  );
});

test("placeholders are filled, and an unknown key is shown rather than thrown", () => {
  assert.equal(translate("en", "zones.setupCount", { count: 7 }), "7 setups");
  assert.equal(translate("id", "zones.setupCount", { count: 7 }), "7 setup");
  // A value the caller forgot leaves the marker visible instead of printing
  // "undefined", which at least says which one is missing.
  assert.match(translate("en", "zones.setupCount"), /\{count\}/);
  assert.equal(
    translate("en", "nope.not.a.key" as never),
    "nope.not.a.key",
    "a missing key is returned as itself",
  );
});

test("every gated feature and every setup status can be said in both languages", () => {
  for (const feature of Object.keys(featureLabel) as FeatureKey[]) {
    assert.ok(domainMessageKey("feature", feature), `no copy for the ${feature} lock`);
  }
  for (const status of [...ACTIVE_SETUP_STATUSES, ...TERMINAL_SETUP_STATUSES]) {
    assert.ok(statusMessageKey(status), `no copy for the "${status}" status`);
  }
  // An unknown value falls back rather than inventing a key.
  assert.equal(statusMessageKey("Something else"), null);
  assert.equal(domainMessageKey("feature", undefined), null);
});

function series(length: number): Candle[] {
  return Array.from({ length }, (_, i) => {
    const close = 100 + Math.sin(i / 6) * 4 + i * 0.05;
    return {
      time: 1_700_000_000 + i * 900,
      open: close - 0.2,
      high: close + 0.6,
      low: close - 0.6,
      close,
      volume: 1_000,
    };
  });
}

test("the analysis is written in the reader's language and says the same thing", () => {
  const candles = series(200);
  const context = {
    sdName: "Demand Zone (72%)",
    confidence: 72,
    pair: "BTC/USDT",
    direction: "long" as const,
    entry: 100,
    target1: 104,
    target2: 108,
    stopLoss: 98,
    status: "Limit Order",
    zoneStrength: "tested" as const,
    zoneTouches: 3,
  };
  const indonesian = buildReasoning(candles, { ...context, locale: "id" });
  const english = buildReasoning(candles, { ...context, locale: "en" });

  assert.deepEqual(
    indonesian.map((section) => section.id),
    english.map((section) => section.id),
    "both languages produce the same sections",
  );
  assert.deepEqual(
    indonesian.map((section) => section.points.length),
    english.map((section) => section.points.length),
    "and the same number of statements in each",
  );

  const idText = indonesian.flatMap((s) => s.points).join(" ");
  const enText = english.flatMap((s) => s.points).join(" ");
  assert.notEqual(idText, enText, "the prose actually differs");
  assert.match(idText, /Confidence \*\*72%\*\*/);
  assert.match(enText, /Confidence \*\*72%\*\*/);
  // The measured numbers are the claim; they must survive translation intact.
  for (const figure of ["72%", "100", "98", "104", "108", "3×"]) {
    assert.ok(idText.includes(figure), `Indonesian lost ${figure}`);
    assert.ok(enText.includes(figure), `English lost ${figure}`);
  }
  // No Indonesian left stranded in the English text.
  for (const word of ["Harga", "Zona", "berjarak", "modal", "ambang"]) {
    assert.ok(!enText.includes(word), `English analysis still says "${word}"`);
  }
});

test("an unstated language is Indonesian, the language the product had", () => {
  assert.equal(DEFAULT_LOCALE, "id");
  const candles = series(120);
  const stated = buildReasoning(candles, { sdName: "No Zone Setup", confidence: 0, locale: "id" });
  const unstated = buildReasoning(candles, { sdName: "No Zone Setup", confidence: 0 });
  assert.deepEqual(unstated, stated, "no locale reads exactly as it did before the toggle existed");
});

test("a stored language is honoured and anything else falls back", () => {
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("id"), "id");
  // localStorage is writable from the console, so junk must not reach the DOM.
  for (const junk of [null, undefined, "", "EN", "jv", "en-US", 1, {}]) {
    assert.equal(normalizeLocale(junk), DEFAULT_LOCALE, String(junk));
  }
  assert.equal(normalizeFromPreferences("en"), "en", "re-exported for the UI layer");
  assert.equal(oppositeLocale("id"), "en");
  assert.equal(oppositeLocale("en"), "id");
});

test("the language is restored before the first paint, like the theme", () => {
  // Restored during hydration it would arrive a paint late, and the reader
  // would watch the interface change language in front of them.
  const script = preferencesScript();
  assert.ok(script.includes("coinsecret:locale"), "the stored key is read");
  assert.ok(script.includes('"lang"'), "and written to the standard attribute");
  assert.ok(script.includes('l==="en"||l==="id"'), "with anything else ignored");
});

test("a reasoning sentence falls back to Indonesian for an unknown language", () => {
  assert.equal(
    say("de" as never, "section.momentum"),
    REASONING_COPY["section.momentum"].id,
    "an unexpected locale still produces a sentence",
  );
});

import type { Locale } from "@/core/domain/i18n/locale";

/**
 * Every sentence the analysis writes, in both languages.
 *
 * The engine composes prose, not labels: each line states a measured fact and
 * the numbers are substituted into it. Keeping the two languages on adjacent
 * lines is what stops one of them from quietly saying something the other does
 * not — a translated sentence that has drifted from its original is worse than
 * no translation, because the reader has no way to tell.
 *
 * `**bold**` markers are part of the sentence: the renderer emphasises the
 * measured numbers, so they belong in both languages in the same places.
 */
const COPY = {
  // --------------------------------------------------------------- sections
  "section.summary": { id: "Ringkasan Setup", en: "Setup Summary" },
  "section.structure": { id: "Struktur Pasar", en: "Market Structure" },
  "section.levels": { id: "Level Kunci", en: "Key Levels" },
  "section.momentum": { id: "Momentum", en: "Momentum" },
  "section.risk": { id: "Manajemen Risiko", en: "Risk Management" },

  // ------------------------------------------------------------------ words
  "word.bullish": { id: "bullish", en: "bullish" },
  "word.bearish": { id: "bearish", en: "bearish" },
  "word.neutral": { id: "netral", en: "neutral" },
  "word.sideways": { id: "sideways", en: "sideways" },
  "word.long": { id: "long", en: "long" },
  "word.short": { id: "short", en: "short" },
  "word.demand": { id: "demand", en: "demand" },
  "word.supply": { id: "supply", en: "supply" },
  "word.above": { id: "di atas", en: "above" },
  "word.below": { id: "di bawah", en: "below" },
  "word.asset": { id: "aset ini", en: "this asset" },

  // ---------------------------------------------------------------- summary
  "summary.zoneActive": {
    id: "Zona {zone} aktif pada {pair}. Arah setup {direction}.",
    en: "A {zone} zone is active on {pair}. The setup is {direction}.",
  },
  "summary.noZone": {
    id: "Belum ada zona supply maupun demand yang valid.",
    en: "There is no valid supply or demand zone yet.",
  },
  "summary.confidence": { id: "Confidence **{confidence}%**.", en: "Confidence **{confidence}%**." },
  "summary.entryStop": {
    id: "Entry **{entry}**. Stop loss **{stopLoss}**.",
    en: "Entry **{entry}**. Stop loss **{stopLoss}**.",
  },
  "summary.bias": { id: "Bias pasar {bias}.", en: "Market bias is {bias}." },
  "summary.targets": {
    id: "Target **{target1}** dan **{target2}**.",
    en: "Targets **{target1}** and **{target2}**.",
  },
  "summary.supportResistance": {
    id: "Support **{support}**. Resistance **{resistance}**.",
    en: "Support **{support}**. Resistance **{resistance}**.",
  },
  "summary.status": { id: "Status setup: {status}.", en: "Setup status: {status}." },

  // -------------------------------------------------------------- structure
  "structure.ema20": {
    id: "Harga berada {side} EMA 20.",
    en: "Price is {side} the EMA 20.",
  },
  "structure.ema50": {
    id: "Harga berada {side} EMA 50.",
    en: "Price is {side} the EMA 50.",
  },
  "structure.market": {
    id: "Struktur pasar {structure}.",
    en: "Market structure is {structure}.",
  },

  // ----------------------------------------------------------------- levels
  "levels.resistance": {
    id: "Resistance terdekat **{price}**.",
    en: "Nearest resistance **{price}**.",
  },
  "levels.support": { id: "Support terdekat **{price}**.", en: "Nearest support **{price}**." },

  // --------------------------------------------------------------- momentum
  "momentum.rsi": {
    id: "RSI(14) **{value}** menunjukkan momentum {tone}.",
    en: "RSI(14) at **{value}** reads as {tone} momentum.",
  },
  "momentum.riskReward": {
    id: "Risk-Reward **1:{ratio}**.",
    en: "Risk-reward **1:{ratio}**.",
  },

  // ------------------------------------------------------------------- risk
  "risk.stopDistance": {
    id: "Stop loss **{stopLoss}** berjarak **{percent}%** dari entry **{entry}**.",
    en: "The stop loss at **{stopLoss}** sits **{percent}%** away from the entry at **{entry}**.",
  },
  "risk.stopInsideSwing": {
    id: "Jarak stop hanya **{atr}×ATR(14)**, masih di dalam ayunan normal, sehingga rawan tersentuh noise.",
    en: "The stop is only **{atr}×ATR(14)** away, inside the market's normal swing, so ordinary noise can reach it.",
  },
  "risk.stopOutsideSwing": {
    id: "Jarak stop **{atr}×ATR(14)**, berada di luar ayunan normal pada timeframe ini.",
    en: "The stop is **{atr}×ATR(14)** away, beyond the normal swing on this timeframe.",
  },
  "risk.positionSize": {
    id: "Dengan risiko **1% modal** per posisi, ukuran posisi maksimal **{percent}%** dari modal.",
    en: "Risking **1% of capital** per position caps this one at **{percent}%** of capital.",
  },
  "risk.rewardMeets": {
    id: "Risk-Reward **1:{ratio}** memenuhi ambang minimum 1:2.",
    en: "A risk-reward of **1:{ratio}** clears the 1:2 minimum.",
  },
  "risk.rewardBelow": {
    id: "Risk-Reward **1:{ratio}** berada di bawah ambang 1:2, sehingga setup ini menuntut win rate lebih tinggi.",
    en: "A risk-reward of **1:{ratio}** is under the 1:2 threshold, so this setup demands a higher win rate.",
  },
  "risk.zoneFresh": {
    id: "Zona belum pernah disentuh ulang, sehingga likuiditas di dalamnya masih utuh.",
    en: "The zone has not been revisited, so the liquidity inside it is still intact.",
  },
  "risk.zoneTouched": {
    id: "Zona sudah tersentuh **{touches}×**; tiap sentuhan mengikis likuiditas yang tersisa dan menurunkan confidence ke **{confidence}%**.",
    en: "The zone has been touched **{touches}×**; each visit eats into the liquidity left and brings confidence down to **{confidence}%**.",
  },
  "risk.priceAtEntry": {
    id: "Harga **{price}** sudah berada tepat pada entry.",
    en: "Price **{price}** is sitting right on the entry.",
  },
  "risk.priceAwayFromEntry": {
    id: "Harga **{price}** masih **{percent}%** {side} entry, jadi posisi dipasang sebagai limit order, bukan market.",
    en: "Price **{price}** is still **{percent}%** {side} the entry, so the position goes in as a limit order rather than at market.",
  },
  "risk.invalidation": {
    id: "Setup batal apabila candle ditutup {side} **{stopLoss}**.",
    en: "The setup is void once a candle closes {side} **{stopLoss}**.",
  },
  "risk.nothingToMeasure": {
    id: "Belum ada level entry maupun stop yang valid, sehingga belum ada risiko yang dapat diukur.",
    en: "There is no valid entry or stop yet, so there is no risk to measure.",
  },
} as const satisfies Record<string, Record<Locale, string>>;

export type ReasoningKey = keyof typeof COPY;

/** One reasoning sentence, with its measured numbers substituted in. */
export function say(
  locale: Locale,
  key: ReasoningKey,
  vars?: Record<string, string | number>,
): string {
  const entry = COPY[key] as Record<Locale, string>;
  const text = entry[locale] ?? entry.id;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export const REASONING_COPY = COPY;

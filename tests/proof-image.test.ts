import test from "node:test";
import assert from "node:assert/strict";
import {
  bucketCandles,
  bucketFactor,
  composeProofImage,
  escapeXml,
  formatDuration,
  LAYOUT,
  PROOF_SIZE,
  proofWindow,
  resultPercent,
  type ProofInput,
} from "@/core/domain/promo/proof-image";
import type { Candle } from "@/core/domain/models";

const BAR = 900;
const START = 1_700_000_000;

/** A descending market: a short that works. */
function candles(count: number): Candle[] {
  let close = 100;
  return Array.from({ length: count }, (_, i) => {
    const open = close;
    close = open - 0.15 + Math.sin(i / 5) * 0.4;
    return {
      time: START + i * BAR,
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
      volume: 100,
    };
  });
}

function proof(overrides: Partial<ProofInput> = {}): ProofInput {
  const bars = candles(120);
  return {
    symbol: "NEOUSDT",
    timeframe: "15m",
    direction: "short",
    entry: 99,
    target1: 96,
    target2: 93,
    stopLoss: 102,
    confidence: 65,
    riskReward: 2,
    zoneTop: 101,
    zoneBottom: 99,
    candles: bars,
    entryFilledTime: bars[40].time,
    entryFilledPrice: 99,
    targetReachedTime: bars[100].time,
    targetReachedPrice: 93,
    ...overrides,
  };
}

test("the window is anchored on the trade, not on the whole history", () => {
  // The failure this pins: a fixed window gave one setup three hundred bars of
  // prologue and ninety of trade, burying the thing the picture is about.
  const wide = proofWindow(1000, 700, 790);
  assert.ok(wide.from > 0, "a long history is trimmed from the left");
  const shownBefore = 700 - wide.from;
  const shownTrade = 790 - 700;
  assert.ok(shownBefore <= shownTrade, "the lead-in never dwarfs the trade itself");
  assert.ok(shownBefore >= 30, "but there is always enough approach to read");
  assert.ok(wide.to > 790, "and a little room after the target");
  assert.ok(wide.to <= 1000);
});

test("a short trade still gets a readable run-up", () => {
  const tight = proofWindow(500, 200, 205);
  assert.equal(200 - tight.from, 30, "a five-bar trade still shows thirty bars before it");
});

test("bars are grouped rather than squeezed when a trade runs long", () => {
  assert.equal(bucketFactor(150), 1, "a short window is drawn bar for bar");
  assert.ok(bucketFactor(545) > 1, "a five-hundred-bar window is grouped");

  const bars = candles(9);
  const grouped = bucketCandles(bars, 3);
  assert.equal(grouped.length, 3);
  // Grouping is a change of interval, not a loss of truth: the same open, the
  // same close, and the real extremes in between.
  assert.equal(grouped[0].open, bars[0].open);
  assert.equal(grouped[0].close, bars[2].close);
  assert.equal(grouped[0].high, Math.max(bars[0].high, bars[1].high, bars[2].high));
  assert.equal(grouped[0].low, Math.min(bars[0].low, bars[1].low, bars[2].low));
  assert.equal(grouped[0].time, bars[0].time, "a group is stamped by the bar it starts on");
});

test("grouping never drops the tail of a window", () => {
  const bars = candles(10);
  const grouped = bucketCandles(bars, 3);
  assert.equal(grouped[grouped.length - 1].close, bars[9].close, "the last bar survives");
});

test("both panels are drawn on the same scales", () => {
  // The whole point of the redesign: the zone and the levels must sit at the
  // same height in each half, and the bars at the same width, or the reader
  // has to re-orient halfway through.
  const svg = composeProofImage(proof());
  const chartHeight = LAYOUT.panelHeight - LAYOUT.chartTop - LAYOUT.chartBottom;
  const entryChartTop = LAYOUT.entryTop + LAYOUT.chartTop;
  const resultChartTop = LAYOUT.resultTop + LAYOUT.chartTop;

  // Each level is drawn once per panel, at the same offset within it.
  const dashed = [...svg.matchAll(/<line x1="\d+" y1="([\d.]+)"[^>]*stroke-dasharray="5 5"/g)]
    .map((m) => Number(m[1]));
  const inEntry = dashed.filter((y) => y >= entryChartTop && y <= entryChartTop + chartHeight);
  const inResult = dashed.filter((y) => y >= resultChartTop && y <= resultChartTop + chartHeight);
  assert.equal(inEntry.length, 4, "four levels in the entry panel");
  assert.equal(inResult.length, 4, "four levels in the result panel");

  const offsetsEntry = inEntry.map((y) => +(y - entryChartTop).toFixed(1)).sort();
  const offsetsResult = inResult.map((y) => +(y - resultChartTop).toFixed(1)).sort();
  assert.deepEqual(offsetsEntry, offsetsResult, "the levels sit at identical heights");
});

test("the entry panel hides what happened next, opaquely", () => {
  const svg = composeProofImage(proof());
  assert.ok(svg.includes("Hasil selanjutnya disembunyikan"), "the hidden stretch says so");
  // An overlay that lets the outcome show through is not a reveal. The cover
  // carries no opacity attribute at all.
  const cover = /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#0e0e16" \/>/.test(svg);
  assert.ok(cover, "the cover is fully opaque");
});

test("the result panel reveals the run and marks where it started", () => {
  const svg = composeProofImage(proof());
  assert.ok(svg.includes("momen entry"), "the fill is marked for reference");
  assert.match(svg, /stroke-dasharray="6 5"/, "as a dashed playhead, not a solid one");
});

test("the metric strip states the whole claim", () => {
  const svg = composeProofImage(proof());
  for (const label of ["CONFIDENCE", "RISK / REWARD", "DURASI", "HASIL"]) {
    assert.ok(svg.includes(label), `${label} missing from the strip`);
  }
  assert.ok(svg.includes("65%"), "confidence is shown");
  assert.ok(svg.includes("1 : 2"), "risk-reward is shown");
});

test("a profitable short reads as a gain, not a loss", () => {
  // Price fell from 99 to 93. For a short that is six percent made, and
  // printing it as negative would call a win a loss on the shareable image.
  assert.ok(resultPercent(proof()) > 0);
  assert.equal(resultPercent(proof({ direction: "long", entryFilledPrice: 93, targetReachedPrice: 99 })) > 0, true);
});

test("duration is stated in the units a reader thinks in", () => {
  assert.equal(formatDuration(START, START + 3600), "1 jam");
  assert.equal(formatDuration(START, START + 40 * 3600), "40 jam");
  assert.equal(formatDuration(START, START + 96 * 3600), "4 hari");
});

test("the footer carries the disclaimer the brief requires", () => {
  const svg = composeProofImage(proof());
  assert.ok(svg.includes("Not financial advice"), "legal footing");
  assert.ok(svg.includes("DYOR"));
});

test("the image is square and self-contained", () => {
  const svg = composeProofImage(proof());
  assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${PROOF_SIZE}" height="${PROOF_SIZE}"`));
  assert.ok(svg.endsWith("</svg>"));
  // Nothing is drawn past the canvas.
  const ys = [...svg.matchAll(/y="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...ys) <= PROOF_SIZE, "nothing hangs below the frame");
  assert.ok(Math.min(...ys) >= 0, "nothing hangs above it");
});

test("markup cannot be injected through a symbol name", () => {
  assert.equal(escapeXml('<script>&"\''), "&lt;script&gt;&amp;&quot;&apos;");
  const svg = composeProofImage(proof({ symbol: "</text><script>alert(1)</script>" }));
  assert.doesNotMatch(svg, /<script>/i);
});

test("every candle in the window is drawn in both panels", () => {
  const input = proof();
  const svg = composeProofImage(input);
  const wicks = (svg.match(/stroke-width="1.2"/g) ?? []).length;
  assert.equal(wicks, input.candles.length * 2, "one wick per bar per panel, and no holes");
});

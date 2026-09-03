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
  // An overlay that lets the outcome show through is not a reveal. The cover
  // carries no opacity attribute at all.
  const cover = /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#0e0e16" \/>/.test(svg);
  assert.ok(cover, "the cover is fully opaque");
  // The playhead and the blank half say it plainly enough; a caption on top
  // only repeated them.
  assert.ok(!svg.includes("disembunyikan"), "no caption over the hidden stretch");
});

test("the result panel reveals the run and marks where it started", () => {
  const svg = composeProofImage(proof());
  assert.ok(svg.includes("Entry Moment"), "the fill is marked for reference");
  assert.match(svg, /stroke-dasharray="6 5"/, "as a dashed playhead, not a solid one");
});

test("each panel header states one price and one time, and nothing else", () => {
  const svg = composeProofImage(proof());
  // Entry: the level, not a sentence about the level.
  assert.ok(svg.includes(">Entry 99<"), "the entry panel names the fill price plainly");
  assert.ok(!svg.includes("Harga saat entry"), "no prose in front of it");
  // Result: what the trade was closed at, in the term a trader uses.
  assert.match(svg, />Take Profit 93\s+\(\+6\.1%\)</, "the result panel names the exit");
  // The duration is stated once, in the metric strip, at a size worth reading.
  // Repeating it beside the timestamp was the same fact twice.
  // Sixty 15-minute bars from the fill to the target.
  assert.equal((svg.match(/15 hours/g) ?? []).length, 1, "duration appears exactly once");
  assert.ok(!svg.includes("kemudian"));
});

test("the picture is written in one language", () => {
  // Shared publicly, so a reader meets English throughout rather than two
  // languages in one frame.
  const svg = composeProofImage(proof());
  for (const word of ["Harga", "Akhir", "momen", "jam", "hari", "kemudian", "DURASI", "HASIL", "analisis"]) {
    assert.ok(!svg.includes(word), `Indonesian left in the image: ${word}`);
  }
});

test("the metric strip states the whole claim", () => {
  const svg = composeProofImage(proof());
  for (const label of ["CONFIDENCE", "RISK / REWARD", "DURATION", "RESULT"]) {
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
  assert.equal(formatDuration(START, START + 3600), "1 hour", "singular reads as singular");
  assert.equal(formatDuration(START, START + 40 * 3600), "40 hours");
  assert.equal(formatDuration(START, START + 96 * 3600), "4 days");
  assert.equal(formatDuration(START, START + 25 * 3600), "25 hours", "a day and a bit is still hours");
});

test("the footer carries the disclaimer, and only that", () => {
  const svg = composeProofImage(proof());
  assert.ok(svg.includes("Not Financial Advice · DYOR"), "legal footing");
  // The tagline that followed it said nothing the picture had not shown.
  assert.ok(!svg.includes("berbasis aturan"), "no tagline trailing the disclaimer");
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

/** Wicks are the only lines drawn in a candle's own colour. */
function wickCount(svg: string): number {
  return (svg.match(/stroke="#(089981|f23645)"/g) ?? []).length;
}

/** Body rects, in the order they are drawn: entry panel first, then result. */
function bodies(svg: string): Array<{ x: number; width: number }> {
  return [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" fill="#(?:089981|f23645)"/g)]
    .map((m) => ({ x: Number(m[1]), width: Number(m[2]) }));
}

test("every candle in the window is drawn in both panels", () => {
  const input = proof();
  const svg = composeProofImage(input);
  assert.equal(wickCount(svg), input.candles.length * 2, "one wick per bar per panel, and no holes");
});

test("a candle is wider than the gap beside it, at every bar count", () => {
  // The complaint this pins: bodies were capped at ten pixels while a short
  // window gave each bar twenty to itself, so half the plot was background and
  // the chart read as sparse sticks with holes between them.
  for (const count of [35, 44, 50, 70, 100, 150, 200]) {
    const bars = candles(count);
    const svg = composeProofImage(
      proof({
        candles: bars,
        entryFilledTime: bars[Math.floor(count * 0.4)].time,
        entryFilledPrice: bars[Math.floor(count * 0.4)].close,
        targetReachedTime: bars[Math.floor(count * 0.8)].time,
        targetReachedPrice: bars[Math.floor(count * 0.8)].close,
      }),
    );
    const drawn = bodies(svg).slice(0, count);
    assert.equal(drawn.length, count, `${count} bars: not every body was drawn`);
    // Measured off the picture rather than recomputed from the layout, so the
    // assertion cannot drift with the constants it is checking.
    const slot = drawn[1].x - drawn[0].x;
    const ratio = drawn[0].width / slot;
    assert.ok(ratio >= 0.6, `${count} bars: body fills only ${(ratio * 100).toFixed(0)}% of its slot`);
    assert.ok(ratio <= 0.95, `${count} bars: bodies touch each other (${(ratio * 100).toFixed(0)}%)`);
  }
});

test("a flat bar is still a bar, not a gap in the row", () => {
  // A candle that opened and closed at one price has no body to draw. Without
  // a floor it vanishes, and a vanished bar is a hole in the chart.
  const flat = candles(60).map((c, i) =>
    i % 4 === 0 ? { ...c, open: c.close, high: c.close + 0.3, low: c.close - 0.3 } : c,
  );
  const svg = composeProofImage(proof({ candles: flat }));
  const heights = [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)" fill="#(?:089981|f23645)"/g)]
    .map((m) => Number(m[1]));
  assert.equal(heights.length, flat.length * 2, "every bar drew a body");
  assert.ok(Math.min(...heights) >= 1, "including the ones that closed where they opened");
});

test("the wick keeps up with the body", () => {
  // A hairline shadow through a wide body looked like a thread through a
  // block; on dense windows it stays a hairline.
  const wide = composeProofImage(proof({ candles: candles(40) }));
  const dense = composeProofImage(proof({ candles: candles(200) }));
  const widthOf = (svg: string) => Number(/stroke="#(?:089981|f23645)" stroke-width="([\d.]+)"/.exec(svg)![1]);
  assert.ok(widthOf(wide) > widthOf(dense), "wide bars get a thicker wick");
  assert.ok(widthOf(dense) >= 1.2, "and a dense chart keeps a visible one");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  composePnlCard,
  escapeXml,
  formatCardDate,
  formatDuration,
  pnlPercent,
  PNL_HEIGHT,
  PNL_WIDTH,
  type PnlInput,
} from "@/core/domain/promo/pnl-card";

const HOUR = 3_600;
const CLOSED = 1_788_498_000;

function card(overrides: Partial<PnlInput> = {}): PnlInput {
  return {
    symbol: "BTCUSDT",
    outcome: "target",
    direction: "long",
    entryPrice: 61_234.5,
    exitPrice: 72_880.2,
    confidence: 80,
    riskReward: 2,
    entryTime: CLOSED - 5 * HOUR,
    exitTime: CLOSED,
    ...overrides,
  };
}

test("a profitable short reads as a gain, not a loss", () => {
  // Price fell from 100 to 90. For a short that is ten percent made, and
  // printing it as negative would call a win a loss on the one image built to
  // be shared.
  const short = card({ direction: "short", entryPrice: 100, exitPrice: 90 });
  assert.equal(pnlPercent(short), 10);
  assert.ok(composePnlCard(short).includes("+10%"));

  const long = card({ direction: "long", entryPrice: 100, exitPrice: 90 });
  assert.equal(pnlPercent(long), -10);
  const svg = composePnlCard(long);
  assert.ok(svg.includes("-10%"));
  assert.ok(!svg.includes("+-10%"), "a loss is not given a plus sign as well");
});

test("a loss is red and a win is green", () => {
  assert.match(composePnlCard(card()), /fill="#22c55e"/);
  assert.match(composePnlCard(card({ exitPrice: 59_000 })), /fill="#f43f5e"/);
});

test("the outcome is named, not implied by the colour alone", () => {
  assert.ok(composePnlCard(card()).includes("Target 2 Reached"));
  assert.ok(composePnlCard(card({ outcome: "stop" })).includes("Stop Loss/Invalid"));
});

test("the three qualifying figures are all stated", () => {
  const svg = composePnlCard(card());
  for (const label of ["Confidence", "Risk/Reward", "Duration"]) {
    assert.ok(svg.includes(label), `${label} missing`);
  }
  assert.ok(svg.includes("80%"));
  assert.ok(svg.includes("1:2"));
  assert.ok(svg.includes("5 Hours"));
});

test("duration is stated in the units a reader thinks in", () => {
  assert.equal(formatDuration(0, HOUR), "1 Hour");
  assert.equal(formatDuration(0, 5 * HOUR), "5 Hours");
  assert.equal(formatDuration(0, 40 * HOUR), "40 Hours");
  assert.equal(formatDuration(0, 96 * HOUR), "4 Days");
  assert.equal(formatDuration(0, 24 * HOUR), "24 Hours", "a day and under is still hours");
});

test("the date is the day the trade closed, not the day it opened", () => {
  const input = card({ entryTime: CLOSED - 72 * HOUR });
  assert.equal(formatCardDate(input.exitTime), formatCardDate(CLOSED));
  assert.ok(composePnlCard(input).includes(formatCardDate(CLOSED)));
  assert.ok(!composePnlCard(input).includes(formatCardDate(input.entryTime)));
});

test("the card is the shape the design asks for and is self-contained", () => {
  const svg = composePnlCard(card());
  assert.ok(
    svg.startsWith(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PNL_WIDTH}" height="${PNL_HEIGHT}"`,
    ),
  );
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(!/NaN|Infinity|undefined/.test(svg), "no unusable coordinate reached the markup");
});

test("nothing on the left column runs under the decorative field", () => {
  // The backdrop starts at x=760. Every word of the claim is placed to the
  // left of it, so a long pair name can never end up sitting on a rectangle.
  const svg = composePnlCard(card({ symbol: "1000SATSUSDT" }));
  // Every text element, then the ones that are not right-aligned to the far
  // edge. The earlier version of this required a `text-anchor` attribute to be
  // present at all, so the labels that carry none — which is most of the left
  // column — were never looked at, and it passed with the claim moved right
  // under the rectangles.
  const elements = svg.match(/<text [^>]*>/g) ?? [];
  const lefts = elements
    .filter((element) => !element.includes('text-anchor="end"'))
    .map((element) => Number(/ x="(\d+)"/.exec(element)?.[1] ?? -1));
  assert.ok(lefts.length >= 6, `expected the left column to have labels, found ${lefts.length}`);
  for (const x of lefts) assert.ok(x >= 0 && x < 760, `a left-column label starts at ${x}`);
});

test("markup cannot be injected through a symbol name", () => {
  assert.equal(escapeXml('<script>&"\''), "&lt;script&gt;&amp;&quot;&apos;");
  assert.doesNotMatch(
    composePnlCard(card({ symbol: "</text><script>alert(1)</script>" })),
    /<script>/i,
  );
});

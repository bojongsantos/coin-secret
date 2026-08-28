import test from "node:test";
import assert from "node:assert/strict";
import {
  canComposeResult,
  FILLED_STATUSES,
  isFilledStatus,
  isTerminalStatus,
  owesEntrySnapshot,
} from "@/core/domain/promo/capture-trigger";
import { setupSignature } from "@/core/domain/analysis/setup-signature";
import {
  CHART_H,
  CHART_Y,
  composeResultImage,
  escapeXml,
  PANEL,
  renderSnapshotSvg,
  SNAPSHOT_WIDTH,
  type SnapshotInput,
} from "@/core/domain/promo/result-image";
import type { Candle } from "@/core/domain/models";

function candles(count: number, from = 100): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = from + Math.sin(i / 4) * 3 + i * 0.15;
    return {
      time: 1_700_000_000 + i * 900,
      open: close - 0.4,
      high: close + 1.1,
      low: close - 1.2,
      close,
      volume: 1_000,
    };
  });
}

const snapshot = (status: string): SnapshotInput => ({
  symbol: "BNBUSDT",
  timeframe: "15m",
  candles: candles(90),
  price: 112.4,
  capturedAt: "2026-08-25 16:30",
  setup: {
    direction: "long",
    entry: 104,
    target1: 112,
    target2: 120,
    stopLoss: 99,
    confidence: 61,
    riskReward: 2,
    status,
    zoneTop: 105,
    zoneBottom: 101,
  },
});

test("a setup keeps one identity while its plan is replanned", () => {
  // The bug this pins, and it is the reason the archive stayed empty: the
  // protective stop is placed beyond the latest confirmed swing, so it moves
  // as bars arrive. Hashing the levels minted a new identity nearly every
  // sweep — one symbol held eleven rows for one setup — and a row that has
  // never been seen before has no previous status to have changed from.
  const zone = { symbol: "ALLOUSDT", timeframe: "15m" as const, direction: "long" as const, zoneBaseTime: 1_787_700_000 };
  const monday = setupSignature(zone);
  const laterThatHour = setupSignature({ ...zone });
  assert.equal(monday, laterThatHour);

  // A different zone is a different setup, even on the same pair and side.
  assert.notEqual(monday, setupSignature({ ...zone, zoneBaseTime: 1_787_700_900 }));
  assert.notEqual(monday, setupSignature({ ...zone, direction: "short" }));
  assert.notEqual(monday, setupSignature({ ...zone, symbol: "ENAUSDT" }));
  assert.notEqual(monday, setupSignature({ ...zone, timeframe: "1H" }));
});

test("a setup that filled while we watched still owes its entry photograph", () => {
  // The bug this pins: the trigger compared the status seen now against the
  // status stored last time. The live scan writes that column too, so by the
  // time the sweep looked the value had already moved and nothing appeared to
  // have changed. A whole day of sweeps reported success and captured nothing.
  const owed = (status: string) =>
    owesEntrySnapshot({ firstStatus: "Limit Order", status, hasEntrySnapshot: false });

  assert.equal(owed("Filled"), true);
  assert.equal(owed("Running"), true);
  assert.equal(owed("Target 1 reached"), true);
  // A late sweep can meet a setup that has already run its whole course. It
  // still deserves its before-picture.
  assert.equal(owed("Target 2 reached"), true);
  // Not filled yet: nothing to photograph.
  assert.equal(owed("Limit Order"), false);
  assert.equal(owed("Missed"), false);
});

test("a setup already filled when we met it is never photographed", () => {
  // There is no before-picture to pair it with, and a result built from it
  // would imply the scanner called the entry in advance when it did not.
  for (const firstStatus of ["Filled", "Running", "Target 1 reached", ""]) {
    assert.equal(
      owesEntrySnapshot({ firstStatus, status: "Running", hasEntrySnapshot: false }),
      false,
      `first seen as ${firstStatus || "unknown"}`,
    );
  }
});

test("a setup is photographed once, not on every sweep", () => {
  assert.equal(
    owesEntrySnapshot({ firstStatus: "Limit Order", status: "Running", hasEntrySnapshot: true }),
    false,
  );
});

test("a finished setup is recognised as finished", () => {
  // The sweep stops re-checking a setup once this is true, so a status that
  // failed to register here would be looked up forever.
  assert.equal(isTerminalStatus("Target 2 reached"), true);
  assert.equal(isTerminalStatus("Invalidated (SL hit)"), true);
  assert.equal(isTerminalStatus("Missed"), true);
  assert.equal(isTerminalStatus("Target 1 reached"), false, "the first target is a partial");
  assert.equal(isTerminalStatus("Running"), false);
});

test("a proof needs both halves", () => {
  assert.equal(canComposeResult(true, true), true);
  assert.equal(canComposeResult(true, false), false);
  assert.equal(canComposeResult(false, true), false);
});

test("markup cannot be injected through a symbol name", () => {
  assert.equal(escapeXml('<script>&"\''), "&lt;script&gt;&amp;&quot;&apos;");
  const svg = composeResultImage({
    symbol: '</text><script>alert(1)</script>',
    entry: snapshot("Filled"),
    result: snapshot("Target 2 reached"),
  });
  assert.doesNotMatch(svg, /<script>/i);
  // The header upper-cases the pair, so match without regard to case.
  assert.match(svg, /&lt;script&gt;/i);
});

test("a snapshot draws one bar per candle and every plan level", () => {
  const svg = renderSnapshotSvg(snapshot("Filled"));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>$/);
  // One wick line per candle, plus four dashed level lines.
  const lines = svg.match(/<line /g) ?? [];
  assert.equal(lines.length, 90 + 4);
  for (const label of ["Entry", "T1", "T2", "SL"]) {
    assert.ok(svg.includes(`${label} `), `${label} missing`);
  }
  assert.ok(svg.includes("Trading Plan"));
  assert.ok(svg.includes("61%"));
});

test("the composed proof carries both snapshots and the branding", () => {
  const svg = composeResultImage({
    symbol: "bnbusdt",
    entry: snapshot("Filled"),
    result: snapshot("Target 2 reached"),
  });
  assert.ok(svg.includes("BNBUSDT RESULT"), "header names the pair in caps");
  assert.ok(svg.includes("ENTRY SNAPSHOT"));
  assert.ok(svg.includes("RESULT SNAPSHOT"));
  assert.ok(svg.includes("Coin Secret"), "header branding");
  assert.ok(svg.includes("coinsecret ·"), "footer watermark");
  // Two stacked bodies, so two of everything a body draws.
  assert.equal((svg.match(/Trading Plan/g) ?? []).length, 2);
});

test("the chart scale makes room for targets price has not reached", () => {
  // Scaling to the candles alone would push an unreached target out of frame,
  // which is exactly the level a before-picture exists to show.
  const far = snapshot("Filled");
  far.setup.target2 = 400;
  const svg = renderSnapshotSvg(far);
  const t2 = svg.match(/T2 400/);
  assert.ok(t2, "the far target is still drawn");
});

/**
 * The plan panel's stacked blocks, top to bottom.
 *
 * Written out as rectangles so the layout can be checked rather than looked
 * at. Two of these offsets were once absolute page coordinates while the rest
 * were relative to the panel, and the result was a heading printed straight
 * through the confidence tile and two price rows sitting on top of it.
 */
function panelBlocks(): Array<{ name: string; top: number; bottom: number }> {
  const blocks = [
    { name: "heading", top: CHART_Y + PANEL.heading - 12, bottom: CHART_Y + PANEL.heading + 4 },
    { name: "title", top: CHART_Y + PANEL.title - 16, bottom: CHART_Y + PANEL.title + 4 },
    { name: "trend", top: CHART_Y + PANEL.trend - 9, bottom: CHART_Y + PANEL.trend + 3 },
    { name: "stats", top: CHART_Y + PANEL.statTop, bottom: CHART_Y + PANEL.statTop + PANEL.statHeight },
    { name: "breakdown", top: CHART_Y + PANEL.breakdown - 8, bottom: CHART_Y + PANEL.breakdown + 3 },
  ];
  for (let i = 0; i < 4; i++) {
    const top = CHART_Y + PANEL.rowsTop + i * PANEL.rowStride;
    blocks.push({ name: `row-${i}`, top, bottom: top + PANEL.rowHeight });
  }
  return blocks;
}

test("nothing in the plan panel is drawn on top of anything else", () => {
  const blocks = panelBlocks();
  for (let i = 1; i < blocks.length; i++) {
    const above = blocks[i - 1];
    const below = blocks[i];
    assert.ok(
      below.top >= above.bottom,
      `${below.name} (from ${below.top}) starts before ${above.name} ends (${above.bottom})`,
    );
  }
});

test("the plan panel finishes inside the panel it is drawn in", () => {
  const last = panelBlocks()[panelBlocks().length - 1];
  assert.ok(
    last.bottom <= CHART_Y + CHART_H,
    `the last row ends at ${last.bottom}, past the panel bottom ${CHART_Y + CHART_H}`,
  );
  assert.ok(panelBlocks()[0].top >= CHART_Y, "the heading starts inside the panel");
});

test("the price pills sit beside the candles, never over them", () => {
  const svg = renderSnapshotSvg(snapshot("Filled"));
  // Every dashed level line stops at the same x, and every pill starts after
  // it. Drawn over the plot, four stacked pills hid the most recent bars —
  // which are the bars the picture exists to show.
  const lineEnds = [...svg.matchAll(/stroke-dasharray="4 4"[^>]*\/>/g)];
  assert.ok(lineEnds.length >= 4, "all four levels are drawn");

  const plotEnd = Number(
    /<line x1="16" y1="[\d.]+" x2="(\d+)"[^>]*stroke-dasharray/.exec(svg)?.[1],
  );
  assert.ok(Number.isFinite(plotEnd), "the level lines have a plot edge");

  const pillXs = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.-]+" width="90"/g)].map((m) =>
    Number(m[1]),
  );
  assert.equal(pillXs.length, 4, "one pill per level");
  for (const x of pillXs) {
    assert.ok(x >= plotEnd, `a pill starts at ${x}, inside the plot that ends at ${plotEnd}`);
  }
  assert.ok(plotEnd < SNAPSHOT_WIDTH, "the plot leaves room for the gutter");
});

test("candle bodies stay wide enough to read", () => {
  const svg = renderSnapshotSvg(snapshot("Filled"));
  const widths = [...svg.matchAll(/<rect x="[\d.-]+" y="[\d.-]+" width="([\d.]+)" height="[\d.]+" fill="#(?:089981|f23645)"/g)]
    .map((m) => Number(m[1]));
  assert.equal(widths.length, 90, "one body per candle");
  for (const width of widths) {
    assert.ok(width >= 2.5, `a candle body is ${width}px wide`);
  }
});

test("a losing status is not printed in the winning colour", () => {
  const lost = snapshot("Invalidated (SL hit)");
  const svg = renderSnapshotSvg(lost);
  const status = /fill="([^"]+)"[^>]*>Invalidated \(SL hit\)</.exec(svg);
  assert.ok(status, "the status is drawn");
  assert.notEqual(status[1], "#22c55e", "a stop-out must not be green");
});

test("only a filled status can owe an entry photograph", () => {
  // The sweep queries the database with this very list, so a status missing
  // from it is a setup the archive silently never photographs.
  for (const status of ["Filled", "Running", "Target 1 reached", "Target 2 reached"] as const) {
    assert.ok(FILLED_STATUSES.includes(status), `${status} must count as filled`);
    assert.equal(isFilledStatus(status), true);
  }
  for (const status of ["Limit Order", "Missed"] as const) {
    assert.equal(isFilledStatus(status), false, `${status} must not count as filled`);
  }
  // A stop-out means it filled and then lost; the archive keeps only winners,
  // so it is deliberately absent.
  assert.equal(isFilledStatus("Invalidated (SL hit)"), false);
});

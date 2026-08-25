import test from "node:test";
import assert from "node:assert/strict";
import { canComposeResult, captureTriggerFor } from "@/core/domain/promo/capture-trigger";
import {
  composeResultImage,
  escapeXml,
  renderSnapshotSvg,
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

test("the entry photograph is taken only on the fill itself", () => {
  assert.equal(captureTriggerFor("Limit Order", "Filled"), "ENTRY");
  // Seen again in the same state on the next sweep: nothing new happened.
  assert.equal(captureTriggerFor("Filled", "Filled"), null);
  assert.equal(captureTriggerFor("Running", "Filled"), null);
});

test("a setup first seen already filled is not photographed", () => {
  // There is no before-picture to pair it with, and a result built from it
  // would imply the scanner called the entry in advance when it did not.
  assert.equal(captureTriggerFor(null, "Filled"), null);
  assert.equal(captureTriggerFor(null, "Target 2 reached"), null);
});

test("reaching the second target is photographed once", () => {
  assert.equal(captureTriggerFor("Filled", "Target 2 reached"), "RESULT");
  assert.equal(captureTriggerFor("Running", "Target 2 reached"), "RESULT");
  assert.equal(captureTriggerFor("Target 2 reached", "Target 2 reached"), null);
});

test("losses and misses are not promoted", () => {
  assert.equal(captureTriggerFor("Filled", "Invalidated (SL hit)"), null);
  assert.equal(captureTriggerFor("Limit Order", "Missed"), null);
  assert.equal(captureTriggerFor("Limit Order", "Running"), null);
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

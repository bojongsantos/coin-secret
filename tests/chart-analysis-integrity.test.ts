import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisResult, buildPerformance, type AnalysisOptions } from "@/core/domain/analysis/analysis-engine";
import { detectSupplyDemand, readPublishedSetup, type PublishedSetup } from "@/core/domain/analysis/supply-demand";
import type { AnalysisResult, Candle, MarketTicker } from "@/core/domain/models";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1_000 };
}

function series(count: number, seed: number): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  let rng = seed;
  const next = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648;
  };
  for (let i = 0; i < count; i++) {
    const move = (next() - 0.5) * (i % 17 === 0 ? 12 : 1.2);
    const open = price;
    price = Math.max(1, price + move);
    out.push(candle(1_700_000_000 + i * 900, open, Math.max(open, price) + next() * 0.4, Math.min(open, price) - next() * 0.4, price));
  }
  return out;
}

function detectedFixture(): Candle[] {
  for (let seed = 1; seed <= 50; seed++) {
    const candles = series(1_000, seed);
    if (detectSupplyDemand(candles).setup) return candles;
  }
  assert.fail("fixture must contain a detector-generated setup that could otherwise replace the published plan");
}

const candles = detectedFixture();
const ticker: MarketTicker = {
  symbol: "BTCUSDT", lastPrice: candles.at(-1)!.close,
  priceChange: 1, priceChangePercent: 1, highPrice: 150, lowPrice: 50, quoteVolume: 1_000_000, volume: 10_000,
};
const held: PublishedSetup = {
  direction: "long", entry: 10_000, target1: 11_000, target2: 12_000, stopLoss: 9_000,
  confidence: 64, zoneTop: 10_000, zoneBottom: 9_500, zoneBaseTime: candles[10].time,
  status: "Limit Order", exchange: "binance",
};

function analyze(published: PublishedSetup | null, options: AnalysisOptions = {}, tape = candles, currentTicker = ticker): AnalysisResult {
  return buildAnalysisResult("BTCUSDT", "BTC", "USDT", "15m", "Binance", tape, currentTicker, published, "en", { computePerformance: false, ...options });
}

test("an unavailable published plan never silently becomes the local detector's plan", () => {
  assert.notEqual(analyze(null).pattern.name, "No Zone Setup", "the local detector must offer a conflicting fallback");
  const result = analyze(null, { publishedOnly: true });
  assert.equal(result.pattern.name, "No Zone Setup");
  assert.deepEqual(result.levels, []);
  assert.equal(result.pattern.shape?.setup, undefined);
});

test("missing published base history suppresses a different detector-generated trading plan", () => {
  const missing = { ...held, zoneBaseTime: candles[0].time - 900 };
  assert.deepEqual(readPublishedSetup(candles, missing, ticker.lastPrice), { status: null, setup: null });
  assert.notEqual(analyze(missing).pattern.name, "No Zone Setup");
  const result = analyze(missing, { publishedOnly: true });
  assert.equal(result.pattern.name, "No Zone Setup");
  assert.deepEqual(result.levels, []);
});

test("terminal published plans do not revive through another detected setup", () => {
  const finished = { ...held, entry: 1, target1: 1.2, target2: 1.4, stopLoss: 0.8, zoneTop: 1, zoneBottom: 0.9 };
  assert.equal(readPublishedSetup(candles, finished, ticker.lastPrice).status, "Missed");
  assert.notEqual(analyze(finished).pattern.name, "No Zone Setup");
  assert.deepEqual(analyze(finished, { publishedOnly: true }).levels, []);
  for (const status of ["Missed", "Invalidated (SL hit)", "Target 2 reached"]) {
    const result = analyze({ ...held, status }, { publishedOnly: true, evaluateLifecycle: false });
    assert.equal(result.pattern.name, "No Zone Setup", status);
    assert.deepEqual(result.levels, [], status);
  }
});

test("an unverified feed cannot change the stored plan's status or levels through another feed's wick", () => {
  const plan: PublishedSetup = {
    direction: "long", entry: 100, target1: 110, target2: 120, stopLoss: 90,
    confidence: 76, zoneTop: 100, zoneBottom: 95, zoneBaseTime: 1,
    status: "Running", exchange: "binance",
  };
  const alternateFeed = [
    candle(1, 97, 99, 95, 98),
    candle(2, 98, 104, 96, 99),
    candle(3, 99, 105, 98, 103),
    candle(4, 103, 105, 85, 95),
  ];
  assert.equal(readPublishedSetup(alternateFeed, plan, 95).status, "Invalidated (SL hit)");
  const reading = readPublishedSetup(alternateFeed, plan, 95, { evaluateLifecycle: false });
  assert.equal(reading.status, "Running");
  assert.equal(reading.setup?.entry, 100);
  assert.equal(reading.setup?.stopLoss, 90);
  const result = analyze(plan, { publishedOnly: true, evaluateLifecycle: false }, alternateFeed, { ...ticker, lastPrice: 95 });
  assert.equal(result.pattern.status, "Running");
  assert.equal(result.pattern.confidence, 76);
  assert.deepEqual(result.levels.map(level => [level.id, level.price]), [["entry", 100], ["target-1", 110], ["target-2", 120], ["sl", 90]]);
});

test("stored status cannot fabricate a published anchor or accept an unsupported lifecycle status", () => {
  const missing = { ...held, zoneBaseTime: candles[0].time - 900, status: "Running" };
  assert.deepEqual(readPublishedSetup(candles, missing, ticker.lastPrice, { evaluateLifecycle: false }), { status: null, setup: null });
  for (const status of [undefined, "unverified", "Live"]) {
    assert.deepEqual(readPublishedSetup(candles, { ...held, status }, ticker.lastPrice, { evaluateLifecycle: false }), { status: null, setup: null });
  }
});

test("skipping the unused live backtest preserves every displayed analysis field", () => {
  const full = analyze(held, { computePerformance: true });
  const live = analyze(held, { computePerformance: false });
  const statistics = buildPerformance(candles);
  assert.equal(full.pattern.probability, statistics.totalTrades >= 3 ? statistics.successRate : 0);
  assert.equal(live.pattern.probability, 0);
  const visible = (result: AnalysisResult) => ({
    ...result, analyzedAt: "timestamp", pattern: { ...result.pattern, detectedAt: "timestamp", probability: "unused" },
  });
  assert.deepEqual(visible(live), visible(full));
});

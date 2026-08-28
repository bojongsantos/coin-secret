import test from "node:test";
import assert from "node:assert/strict";
import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import { runSdScan, SD_SETUP_TIMEFRAMES } from "@/core/application/scanner/supply-demand-scan-service";
import { buildAnalysisResult } from "@/core/domain/analysis/analysis-engine";
import { detectSupplyDemand, type PublishedSetup } from "@/core/domain/analysis/supply-demand";
import type { Candle, Timeframe } from "@/core/domain/models";

const BAR = 900;
const START = 1_700_000_000;

/**
 * A market that trends up into an impulse, leaving a demand zone behind.
 *
 * Deterministic so a scan can be run twice and compared.
 */
function series(count: number, seed: number): Candle[] {
  let price = 100;
  let rng = seed;
  const next = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648;
  };
  return Array.from({ length: count }, (_, i) => {
    const impulse = i % 17 === 0;
    const open = price;
    price = Math.max(1, price + (impulse ? (next() - 0.5) * 12 : (next() - 0.5) * 1.2));
    return {
      time: START + i * BAR,
      open,
      high: Math.max(open, price) + next() * 0.4,
      low: Math.min(open, price) - next() * 0.4,
      close: price,
      volume: 50 + next() * 50,
    };
  });
}

function marketFor(perTimeframe: Partial<Record<Timeframe, Candle[]>>, fallback: Candle[]) {
  const calls: Timeframe[] = [];
  const port = {
    async fetchTickers24h(symbols: string[]) {
      return symbols.map((symbol) => ({
        symbol,
        lastPrice: 100,
        priceChangePercent: 1,
        quoteVolume: 1_000_000,
      }));
    },
    async fetchKlines({ timeframe }: { timeframe: Timeframe }) {
      calls.push(timeframe);
      return perTimeframe[timeframe] ?? fallback;
    },
  } as unknown as MarketDataPort;
  return { port, calls };
}

/** An in-memory stand-in for the database store. */
function store(initial: ActiveSetup[] = []) {
  const rows = new Map(initial.map((s) => [s.symbol, s]));
  const writes: ActiveSetup[] = [];
  const port: ActiveSetupPort = {
    async loadActive(symbols) {
      return symbols.map((s) => rows.get(s)).filter((s): s is ActiveSetup => s !== undefined);
    },
    async persist(setups) {
      for (const s of setups) {
        writes.push(s);
        rows.set(s.symbol, s);
      }
    },
  };
  return { port, rows, writes };
}

test("the scanner looks at every timeframe it claims to", async () => {
  const candles = series(400, 21);
  const { port, calls } = marketFor({}, candles);
  await runSdScan(port, ["BTCUSDT"]);
  for (const timeframe of SD_SETUP_TIMEFRAMES) {
    assert.ok(calls.includes(timeframe), `${timeframe} was never fetched`);
  }
});

test("a published setup survives the next scan unchanged", async () => {
  // The bug this pins: a refresh re-chose the best zone it could see and
  // swapped out the plan somebody was already trading, so a setup could
  // vanish mid-trade and never reach the result archive.
  const candles = series(400, 20);
  const { port } = marketFor({}, candles);

  const first = await runSdScan(port, ["BTCUSDT"]);
  const original = [...first.demand, ...first.supply][0];
  assert.ok(original, "the fixture must produce a setup to begin with");

  const held = store([
    {
      symbol: original.symbol,
      timeframe: original.timeframe,
      direction: original.direction,
      entry: original.entry,
      target1: original.target1,
      target2: original.target2,
      stopLoss: original.stopLoss,
      confidence: original.confidence,
      zoneTop: original.zoneTop,
      zoneBottom: original.zoneBottom,
      zoneBaseTime: original.zoneBaseTime,
      status: original.status,
    },
  ]);

  const second = await runSdScan(port, ["BTCUSDT"], { activeSetups: held.port });
  const kept = [...second.demand, ...second.supply][0];
  assert.ok(kept, "the held setup must still be listed");
  assert.equal(kept.entry, original.entry, "the entry a reader is trading must not move");
  assert.equal(kept.stopLoss, original.stopLoss, "the stop must not move");
  assert.equal(kept.target2, original.target2);
  assert.equal(kept.zoneBaseTime, original.zoneBaseTime, "it must be the same zone");
  assert.equal(kept.timeframe, original.timeframe);
});

test("a held setup is re-read on its own timeframe, not the fast one", async () => {
  const hourly = series(400, 3);
  const { port, calls } = marketFor({ "1H": hourly }, series(400, 5));
  const held = store([
    {
      symbol: "BTCUSDT",
      timeframe: "1H",
      direction: "long",
      // Far above anything the fixture trades at, so price never closes clear
      // of the entry: the setup is still forming and cannot be terminal.
      entry: 10_000,
      target1: 11_000,
      target2: 12_000,
      stopLoss: 9_000,
      confidence: 70,
      zoneTop: 10_000,
      zoneBottom: 9_500,
      zoneBaseTime: hourly[10].time,
      status: "Limit Order",
    },
  ]);

  await runSdScan(port, ["BTCUSDT"], { activeSetups: held.port });
  const hourlyReads = calls.filter((c) => c === "1H").length;
  assert.equal(hourlyReads, 1, "the setup's own timeframe is read exactly once");
  // The fast chart is still fetched for the sparkline; nothing else is.
  assert.deepEqual([...new Set(calls)].sort(), ["15m", "1H"]);
});

test("a setup on a timeframe the scanner dropped is released", async () => {
  // The board is for what can be acted on now. When the scanned set shrinks,
  // setups left behind on the slower charts would otherwise sit there for days
  // with nothing ever refreshing them.
  const candles = series(400, 20);
  const { port } = marketFor({}, candles);
  const held = store([
    {
      symbol: "BTCUSDT",
      timeframe: "1D",
      direction: "long",
      entry: 10_000,
      target1: 11_000,
      target2: 12_000,
      stopLoss: 9_000,
      confidence: 70,
      zoneTop: 10_000,
      zoneBottom: 9_500,
      zoneBaseTime: candles[10].time,
      status: "Limit Order",
    },
  ]);

  const result = await runSdScan(port, ["BTCUSDT"], { activeSetups: held.port });
  const listed = [...result.demand, ...result.supply][0];
  assert.ok(listed, "a replacement setup must be chosen");
  assert.notEqual(listed.timeframe, "1D", "the dropped timeframe must not be republished");
  assert.ok(SD_SETUP_TIMEFRAMES.includes(listed.timeframe));
});

test("a finished setup releases the symbol for a new one", async () => {
  const candles = series(400, 26);
  const { port } = marketFor({}, candles);
  const held = store([
    {
      symbol: "BTCUSDT",
      timeframe: "15m",
      direction: "long",
      // Levels far below the market: price left long ago and never returned,
      // so this reads as Missed and the symbol is free again.
      entry: 1,
      target1: 1.2,
      target2: 1.4,
      stopLoss: 0.8,
      confidence: 55,
      zoneTop: 1,
      zoneBottom: 0.9,
      zoneBaseTime: candles[5].time,
      status: "Limit Order",
    },
  ]);

  const result = await runSdScan(port, ["BTCUSDT"], { activeSetups: held.port });
  const listed = [...result.demand, ...result.supply][0];
  if (listed) {
    assert.notEqual(listed.entry, 1, "the finished setup must not still be published");
  }
  const terminal = held.writes.find((w) => w.entry === 1);
  assert.ok(terminal, "the finished setup's status must be written back");
  assert.ok(
    ["Missed", "Target 2 reached", "Invalidated (SL hit)"].includes(terminal.status),
    `expected a terminal status, got ${terminal.status}`,
  );
});

test("an unchanged status costs no write at all", async () => {
  const candles = series(400, 24);
  const { port } = marketFor({}, candles);
  const first = await runSdScan(port, ["BTCUSDT"]);
  const original = [...first.demand, ...first.supply][0];
  assert.ok(original);

  const held = store([
    {
      symbol: original.symbol,
      timeframe: original.timeframe,
      direction: original.direction,
      entry: original.entry,
      target1: original.target1,
      target2: original.target2,
      stopLoss: original.stopLoss,
      confidence: original.confidence,
      zoneTop: original.zoneTop,
      zoneBottom: original.zoneBottom,
      zoneBaseTime: original.zoneBaseTime,
      status: original.status,
    },
  ]);
  await runSdScan(port, ["BTCUSDT"], { activeSetups: held.port });
  assert.deepEqual(held.writes, [], "a quiet market must not write to the database");
});

test("scanning without a store still works", async () => {
  // The capture sweep and the tests both call it bare; it must stay usable.
  const { port } = marketFor({}, series(400, 23));
  const result = await runSdScan(port, ["BTCUSDT"]);
  assert.ok(Array.isArray(result.demand));
  assert.ok(Array.isArray(result.supply));
});

test("the chart shows the published plan, not one it re-chose", async () => {
  // The bug this pins, reproduced exactly: on this market every zone the
  // detector can still see has already resolved, so it answers with nothing
  // and the chart printed "No Zone Setup" for a symbol the table was listing
  // with a live setup.
  const candles = series(400, 1);
  const ticker = { symbol: "BTCUSDT", lastPrice: candles[candles.length - 1].close, priceChangePercent: 1, quoteVolume: 1_000_000 };
  assert.equal(detectSupplyDemand(candles).setup, null, "the fixture must give the detector nothing");

  const published: PublishedSetup = {
    direction: "long",
    // Above everything this market trades at, so price never closes clear of
    // it: the order is still waiting, which is as non-terminal as it gets.
    entry: 10_000,
    target1: 11_000,
    target2: 12_000,
    stopLoss: 9_000,
    confidence: 64,
    zoneTop: 10_000,
    zoneBottom: 9_500,
    zoneBaseTime: candles[10].time,
  };

  const without = buildAnalysisResult(
    "BTCUSDT", "BTC", "USDT", "15m", "Binance", candles, ticker as never,
  );
  assert.equal(without.pattern.name, "No Zone Setup", "without the plan the chart has nothing");

  const withPlan = buildAnalysisResult(
    "BTCUSDT", "BTC", "USDT", "15m", "Binance", candles, ticker as never, published,
  );
  assert.notEqual(withPlan.pattern.name, "No Zone Setup", "the published plan must be drawn");
  assert.equal(withPlan.pattern.confidence, 64, "and with its own confidence");
  const entry = withPlan.levels.find((l) => l.id === "entry");
  assert.equal(entry?.price, 10_000, "the chart must draw the published entry");
});

test("a published plan price has finished lets the chart move on", async () => {
  // Terminal is terminal on both sides, so the chart stops showing a setup at
  // the same moment the board releases the symbol.
  const candles = series(400, 1);
  const ticker = { symbol: "BTCUSDT", lastPrice: candles[candles.length - 1].close, priceChangePercent: 1, quoteVolume: 1_000_000 };
  const finished: PublishedSetup = {
    direction: "long",
    // Far below the market and long since passed: this reads as Missed.
    entry: 1, target1: 1.2, target2: 1.4, stopLoss: 0.8,
    confidence: 55, zoneTop: 1, zoneBottom: 0.9,
    zoneBaseTime: candles[5].time,
  };
  const result = buildAnalysisResult(
    "BTCUSDT", "BTC", "USDT", "15m", "Binance", candles, ticker as never, finished,
  );
  assert.equal(result.pattern.name, "No Zone Setup", "a finished plan must not still be drawn");
});

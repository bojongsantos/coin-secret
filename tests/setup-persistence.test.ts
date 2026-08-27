import test from "node:test";
import assert from "node:assert/strict";
import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import { runSdScan, SD_SETUP_TIMEFRAMES } from "@/core/application/scanner/supply-demand-scan-service";
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
  const daily = series(400, 3);
  const { port, calls } = marketFor({ "1D": daily }, series(400, 5));
  const held = store([
    {
      symbol: "BTCUSDT",
      timeframe: "1D",
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
      zoneBaseTime: daily[10].time,
      status: "Limit Order",
    },
  ]);

  await runSdScan(port, ["BTCUSDT"], { activeSetups: held.port });
  assert.ok(calls.includes("1D"), "the setup's own timeframe must be read");
  // Only the fast chart (for the sparkline) and the setup's own timeframe.
  assert.ok(!calls.includes("4H"), "a held setup must not trigger a full re-scan");
  assert.ok(!calls.includes("1H"));
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

import test from "node:test";
import assert from "node:assert/strict";
import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort, MarketDataSource } from "@/core/application/ports/market-data-port";
import { runSdScan } from "@/core/application/scanner/supply-demand-scan-service";
import { runScanner } from "@/core/application/scanner/scanner-service";
import type { Candle, MarketTicker } from "@/core/domain/models";

function tape(): Candle[] {
  let price = 100;
  let rng = 26;
  const next = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  return Array.from({ length: 400 }, (_, index) => {
    const open = price;
    price = Math.max(1, price + (index % 17 === 0 ? (next() - 0.5) * 12 : (next() - 0.5) * 1.2));
    return { time: 1_700_000_000 + index * 900, open, high: Math.max(open, price) + next() * 0.4,
      low: Math.min(open, price) - next() * 0.4, close: price, volume: 50 + next() * 50 };
  });
}
const candles = tape();
const ticker = (lastPrice: number): MarketTicker => ({ symbol: "BTCUSDT", lastPrice, priceChange: 1,
  priceChangePercent: 1, quoteVolume: 100, volume: 1, highPrice: lastPrice, lowPrice: lastPrice });
function source(exchange: "binance" | "bybit", price: number, fail?: "batch" | "candles" | "hourly") {
  const reads: string[] = [];
  const marketData: MarketDataPort = {
    fetchKlines: async (query) => {
      reads.push(query.timeframe);
      if (fail === "candles" || fail === "hourly" && query.timeframe === "1H") throw new Error("venue unavailable");
      return candles;
    },
    fetchTickers24h: async () => {
      if (fail === "batch") throw new Error("venue batch unavailable");
      return [ticker(price)];
    },
    fetchTicker24h: async () => ticker(price),
  };
  return { exchange, marketData, reads };
}
function gateway(sources: readonly MarketDataSource[]): MarketDataPort {
  return { sources, fetchKlines: async () => { throw new Error("mixed gateway must not be read"); },
    fetchTicker24h: async () => { throw new Error("mixed gateway must not be read"); },
    fetchTickers24h: async () => { throw new Error("mixed gateway must not be read"); } };
}
function store(initial: ActiveSetup[] = []) {
  const writes: ActiveSetup[] = [];
  const activeSetups: ActiveSetupPort = { loadActive: async () => initial, loadRetiredZones: async () => [],
    persist: async (setups) => { writes.push(...setups); } };
  return { activeSetups, writes };
}

test("new scanner fallback selects one exchange for ticker, every timeframe and the committed plan", async () => {
  const binance = source("binance", 100, "candles");
  const bybit = source("bybit", 200);
  const persisted = store();
  const result = await runSdScan(gateway([binance, bybit]), ["BTCUSDT"], persisted);
  const published = [...result.demand, ...result.supply][0];
  assert.ok(published);
  assert.equal(published.exchange, "bybit");
  assert.equal(result.market[0].exchange, "bybit");
  assert.equal(result.market[0].price, 200);
  assert.ok(persisted.writes.every((setup) => setup.exchange === "bybit"));
  assert.deepEqual(binance.reads, ["15m"]);
  assert.deepEqual(bybit.reads, ["15m", "1H"]);
});

test("a failed batch is not retried for every fresh symbol, and hourly failures do not mix sources", async () => {
  const failedBatch = source("binance", 100, "batch");
  const bybit = source("bybit", 200, "hourly");
  const result = await runSdScan(gateway([failedBatch, bybit]), ["BTCUSDT"]);
  assert.equal(result.market[0].exchange, "bybit");
  assert.deepEqual(failedBatch.reads, []);
  assert.deepEqual(bybit.reads, ["15m", "1H"]);
  assert.equal(result.errors.length, 1);
  assert.ok([...result.demand, ...result.supply].every((hit) => hit.exchange === "bybit"));
});

test("published source remains pinned even when a different exchange is healthy", async () => {
  const bybit = source("bybit", 200);
  const first = await runSdScan(gateway([bybit]), ["BTCUSDT"]);
  const original = [...first.demand, ...first.supply][0];
  assert.ok(original);
  const persisted = store([{ ...original }]);
  const binance = source("binance", 100);
  bybit.reads.length = 0;
  const result = await runSdScan(gateway([binance, bybit]), ["BTCUSDT"], persisted);
  assert.deepEqual(binance.reads, []);
  assert.ok(bybit.reads.length > 0);
  assert.equal(result.market[0].price, 200);
  const hit = [...result.demand, ...result.supply][0];
  assert.ok(hit);
  assert.equal(hit.exchange, "bybit");
  assert.equal(hit.entry, original.entry);
  assert.equal(hit.stopLoss, original.stopLoss);

  const unavailable = source("bybit", 200, "candles");
  const failure = await runSdScan(gateway([binance, unavailable]), ["BTCUSDT"], persisted);
  assert.equal(failure.demand.length + failure.supply.length, 0);
  assert.match(failure.errors[0], /bybit market data unavailable/);
  assert.deepEqual(binance.reads, []);
  assert.equal(persisted.writes.length, 0);
});

test("legacy unknown source preserves levels and stored status without inventing a venue or lifecycle outcome", async () => {
  const binance = source("binance", 100);
  const first = await runSdScan(gateway([binance]), ["BTCUSDT"]);
  const original = [...first.demand, ...first.supply][0];
  assert.ok(original);
  const legacy = { ...original, exchange: null, status: "Limit Order", stopLoss: 99_999 };
  const persisted = store([legacy]);
  const result = await runSdScan(gateway([binance]), ["BTCUSDT"], persisted);
  const hit = [...result.demand, ...result.supply][0];
  assert.equal(hit.exchange, null);
  assert.equal(hit.status, "Limit Order");
  assert.equal(hit.entry, original.entry);
  assert.equal(hit.stopLoss, 99_999);
  assert.equal(result.market[0].exchange, "binance", "chart price provenance is separate from unknown plan provenance");
  assert.equal(persisted.writes.length, 0);
});

for (const [name, scan] of [["signals", runSdScan], ["opportunities", runScanner]] as const) {
  test(`${name}: an unused slow secondary batch cannot delay a healthy primary`, async () => {
    const binance = source("binance", 100);
    const bybit = source("bybit", 200);
    let release!: (value: MarketTicker[]) => void;
    let secondaryBatches = 0;
    const stalled = new Promise<MarketTicker[]>((resolve) => { release = resolve; });
    bybit.marketData.fetchTickers24h = () => { secondaryBatches++; return stalled; };
    let finished = false;
    const pending = scan(gateway([binance, bybit]), ["BTCUSDT"]).then((result) => { finished = true; return result; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const completedWithoutSecondary = finished;
    release([ticker(200)]);
    const result = await pending;
    assert.equal(completedWithoutSecondary, true);
    assert.equal(secondaryBatches, 0);
    assert.deepEqual(bybit.reads, []);
    assert.deepEqual(result.errors, []);
  });

  test(`${name}: a failed primary batch is shared once and never creates 193 failed read pairs`, async () => {
    const binance = source("binance", 100);
    const bybit = source("bybit", 200);
    let primaryBatches = 0;
    let alternateBatches = 0;
    let individualReads = 0;
    binance.marketData.fetchTickers24h = async () => { primaryBatches++; throw new Error("blocked"); };
    bybit.marketData.fetchTickers24h = async (symbols) => {
      alternateBatches++;
      return symbols.map((symbol) => ({ ...ticker(200), symbol }));
    };
    binance.marketData.fetchTicker24h = bybit.marketData.fetchTicker24h = async () => { individualReads++; throw new Error("batch should be reused"); };
    const symbols = Array.from({ length: 193 }, (_, index) => `COIN${index}USDT`);
    const result = await scan(gateway([binance, bybit]), symbols);
    assert.equal(primaryBatches, 1);
    assert.equal(alternateBatches, 1);
    assert.equal(individualReads, 0);
    assert.deepEqual(binance.reads, []);
    assert.deepEqual(result.errors, []);
  });
}

test("an unreadable published base is unavailable without retiring or substituting another plan", async () => {
  const binance = source("binance", 100);
  const first = await runSdScan(gateway([binance]), ["BTCUSDT"]);
  const original = [...first.demand, ...first.supply][0];
  assert.ok(original, "this market must offer an alternative plan if the held one were silently dropped");
  const held = { ...original, exchange: "binance" as const, zoneBaseTime: 1_600_000_000 };
  const persisted = store([held]);
  const result = await runSdScan(gateway([binance]), ["BTCUSDT"], persisted);
  assert.equal(result.demand.length + result.supply.length, 0);
  assert.deepEqual(result.errors, ["BTCUSDT: Published setup history incomplete"]);
  assert.equal(persisted.writes.length, 0);
  assert.equal(held.zoneBaseTime, 1_600_000_000);
  assert.equal(held.status, original.status);
});

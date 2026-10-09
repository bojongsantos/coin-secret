import test from "node:test";
import assert from "node:assert/strict";
import type { ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import { runScannerCached } from "@/core/application/scanner/scanner-service";
import { runSdScanCached } from "@/core/application/scanner/supply-demand-scan-service";

function marketFixture(wait: Promise<void> = Promise.resolve()) {
  let calls = 0;
  const port: MarketDataPort = {
    fetchKlines: async () => [],
    fetchTicker24h: async (symbol) => ({
      symbol, lastPrice: 100, priceChange: 1, priceChangePercent: 1,
      highPrice: 101, lowPrice: 99, quoteVolume: 1000, volume: 10,
    }),
    fetchTickers24h: async (symbols) => {
      calls += 1;
      await wait;
      return Promise.all(symbols.map((symbol) => port.fetchTicker24h(symbol)));
    },
  };
  return { port, calls: () => calls };
}

function setupFixture(): ActiveSetupPort {
  return { loadActive: async () => [], loadRetiredZones: async () => [], persist: async () => {} };
}

for (const [name, scan] of [["opportunities", runScannerCached], ["signals", runSdScanCached]] as const) {
  test(`${name}: forced refreshes and ordinary reads share matching pending work across other scans`, async () => {
    let release!: () => void;
    const market = marketFixture(new Promise<void>((resolve) => { release = resolve; }));
    const first = scan(market.port, ["BTCUSDT"]);
    const second = scan(market.port, ["ETHUSDT"]);
    assert.notEqual(first, second, "different symbol lists must scan independently");
    assert.equal(scan(market.port, ["BTCUSDT"], true), first);
    assert.equal(scan(market.port, ["BTCUSDT"]), first);
    assert.equal(scan(market.port, ["ETHUSDT"], true), second);
    release();
    await Promise.all([first, second]);
    assert.equal(market.calls(), 2, "each distinct board must fan out only once");
  });

  test(`${name}: cache and pending identity include the market provider and published setup store`, async () => {
    const firstMarket = marketFixture();
    const secondMarket = marketFixture();
    const firstStore = setupFixture();
    const secondStore = setupFixture();
    const stateless = await scan(firstMarket.port, ["BTCUSDT"]);
    const published = await scan(firstMarket.port, ["BTCUSDT"], false, { activeSetups: firstStore });
    assert.notEqual(published, stateless, "a stateless scan cannot satisfy a published board");
    assert.equal(await scan(firstMarket.port, ["BTCUSDT"], false, { activeSetups: firstStore }), published);
    const otherStore = scan(firstMarket.port, ["BTCUSDT"], true, { activeSetups: secondStore });
    const otherMarket = scan(secondMarket.port, ["BTCUSDT"], true, { activeSetups: firstStore });
    const originalStore = scan(firstMarket.port, ["BTCUSDT"], true, { activeSetups: firstStore });
    assert.notEqual(otherStore, originalStore);
    assert.notEqual(otherMarket, originalStore);
    await Promise.all([otherStore, otherMarket, originalStore]);
    assert.equal(firstMarket.calls(), 4);
    assert.equal(secondMarket.calls(), 1);
  });

  test(`${name}: a forced refresh replaces a valid cache, and expired results are rescanned`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const market = marketFixture();
    const first = await scan(market.port, ["BTCUSDT"]);
    assert.equal(await scan(market.port, ["BTCUSDT"]), first);
    const forced = await scan(market.port, ["BTCUSDT"], true);
    assert.notEqual(forced, first);
    assert.equal(market.calls(), 2);
    t.mock.timers.tick(60_000);
    assert.notEqual(await scan(market.port, ["BTCUSDT"]), forced);
    assert.equal(market.calls(), 3);
  });

  test(`${name}: a failed published refresh rejects, releases pending work and retries without stale data`, async () => {
    const market = marketFixture();
    let unavailable = false;
    let reads = 0;
    const store: ActiveSetupPort = {
      ...setupFixture(),
      loadActive: async () => {
        reads += 1;
        if (unavailable) throw new Error("setup store unavailable");
        return [];
      },
    };
    await scan(market.port, ["BTCUSDT"], false, { activeSetups: store });
    unavailable = true;
    const forced = scan(market.port, ["BTCUSDT"], true, { activeSetups: store });
    assert.equal(scan(market.port, ["BTCUSDT"], false, { activeSetups: store }), forced);
    await assert.rejects(forced, /setup store unavailable/);
    await assert.rejects(scan(market.port, ["BTCUSDT"], false, { activeSetups: store }), /setup store unavailable/);
    unavailable = false;
    await scan(market.port, ["BTCUSDT"], false, { activeSetups: store });
    assert.equal(reads, 4, "a failed refresh cannot leave an old board cached as live");
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { parseScanSymbols } from "@/core/application/scanner/scan-request";
import { rankTopSetups, signalBucket, type SdScanHit, type SdScanResult } from "@/core/application/scanner/supply-demand-scan-service";
import { normalizeUsdtSymbol } from "@/core/domain/market/symbol";
import { mapConcurrent } from "@/shared/lib/async";

test("symbols normalize once and invalid scan requests are rejected", () => {
  assert.equal(normalizeUsdtSymbol(" btc/usdt "), "BTCUSDT");
  assert.equal(normalizeUsdtSymbol("eth"), "ETHUSDT");
  assert.equal(normalizeUsdtSymbol("币安人生USDT"), "币安人生USDT");
  assert.deepEqual(parseScanSymbols(["btc", "ETH/USDT", "btc"]), ["BTCUSDT", "ETHUSDT"]);
  assert.deepEqual(parseScanSymbols(["币安人生USDT"]), ["币安人生USDT"]);
  assert.throws(() => parseScanSymbols([]), /1-200/);
  assert.throws(() => parseScanSymbols(["@@@"]), /invalid/);
  assert.throws(() => parseScanSymbols(Array.from({ length: 201 }, () => "BTC")), /1-200/);
});

test("concurrent mapper preserves order and respects the limit", async () => {
  let active = 0;
  let peak = 0;
  const output = await mapConcurrent(
    [1, 2, 3, 4, 5, 6],
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
    2,
  );
  assert.deepEqual(output, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2);
});

function hit(symbol: string, confidence: number, strength: SdScanHit["strength"]): SdScanHit {
  return {
    symbol,
    base: symbol.replace(/USDT$/, ""),
    timeframe: "15m",
    zoneType: "demand",
    strength,
    confidence,
    direction: "long",
    entry: 100,
    target1: 110,
    target2: 120,
    stopLoss: 95,
    zoneBaseTime: 1_700_000_000,
    zoneTop: 100,
    zoneBottom: 97,
    change24h: 1,
    volume24h: 1_000,
    zones: 1,
    status: "Running",
  };
}

test("top setups are ranked by confidence and given stable ranks", () => {
  // Confidence is the only score the detector produces, so it is what "top"
  // means here. Freshness used to gate the list; it now only breaks a tie.
  const demand = [hit("AAAUSDT", 90, "tested"), hit("BBBUSDT", 75, "fresh")];
  const supply = [hit("CCCUSDT", 85, "fresh")];
  const result: SdScanResult = {
    demand,
    supply,
    market: [],
    demandTotal: demand.length,
    supplyTotal: supply.length,
    scannedAt: new Date(0).toISOString(),
    errors: [],
  };
  assert.deepEqual(rankTopSetups(result, 3).map((item) => [item.rank, item.hit.symbol]), [
    [1, "AAAUSDT"],
    [2, "CCCUSDT"],
    [3, "BBBUSDT"],
  ]);
});

test("signal category follows Buy/Sell direction even when zone metadata is inconsistent", () => {
  const sell = { ...hit("BTCUSDT", 90, "fresh"), direction: "short" as const, zoneType: "demand" as const };
  const buy = { ...hit("ETHUSDT", 90, "fresh"), direction: "long" as const, zoneType: "supply" as const };
  assert.equal(signalBucket(sell), "supply");
  assert.equal(signalBucket(buy), "demand");
});

test("the top strip is filled even when few setups clear the dashboard floor", () => {
  // The bug this pins: ranking ran over the filtered tables and gated on a
  // "fresh" zone. Published setups all read as tested, so the pool emptied and
  // a strip promising five names showed two.
  const hit = (symbol: string, confidence: number, strength: string, status: string): SdScanHit => ({
    symbol,
    base: symbol.replace(/USDT$/, ""),
    timeframe: "15m",
    zoneType: "demand",
    strength,
    confidence,
    direction: "long",
    entry: 1,
    target1: 1.1,
    target2: 1.2,
    stopLoss: 0.9,
    zoneBaseTime: 1_700_000_000,
    zoneTop: 1,
    zoneBottom: 0.95,
    change24h: 0,
    volume24h: 1_000,
    zones: 1,
    status,
  });

  const scan = {
    demand: [
      hit("AUSDT", 76, "tested", "Filled"),
      hit("BUSDT", 71, "tested", "Running"),
      hit("CUSDT", 44, "tested", "Limit Order"),
      hit("DUSDT", 31, "tested", "Filled"),
    ],
    supply: [
      hit("EUSDT", 22, "tested", "Running"),
      hit("FUSDT", 18, "tested", "Filled"),
      // Finished: never eligible, however confident it once was.
      hit("GUSDT", 99, "fresh", "Target 2 reached"),
    ],
  } as unknown as SdScanResult;

  const top = rankTopSetups(scan, 5);
  assert.equal(top.length, 5, "the strip must be full");
  assert.deepEqual(top.map((t) => t.hit.symbol), ["AUSDT", "BUSDT", "CUSDT", "DUSDT", "EUSDT"]);
  assert.ok(!top.some((t) => t.hit.symbol === "GUSDT"), "a finished setup is not a setup of the day");
  assert.deepEqual(top.map((t) => t.rank), [1, 2, 3, 4, 5]);
});

test("freshness only breaks a tie, it never gates the ranking", () => {
  const base = {
    base: "X", timeframe: "15m" as const, zoneType: "demand" as const, direction: "long" as const,
    entry: 1, target1: 1.1, target2: 1.2, stopLoss: 0.9, zoneBaseTime: 1, zoneTop: 1, zoneBottom: 0.9,
    change24h: 0, volume24h: 1_000, zones: 1, status: "Filled",
  };
  const scan = {
    demand: [{ ...base, symbol: "TESTEDUSDT", confidence: 60, strength: "tested" }],
    supply: [{ ...base, symbol: "FRESHUSDT", confidence: 60, strength: "fresh" }],
  } as unknown as SdScanResult;
  const top = rankTopSetups(scan, 2);
  assert.equal(top[0].hit.symbol, "FRESHUSDT", "equal confidence: the fresher zone leads");
  assert.equal(top.length, 2, "but the tested one is still ranked");
});

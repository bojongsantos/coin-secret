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

test("top setups prioritize live fresh zones and assign stable ranks", () => {
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
  assert.deepEqual(rankTopSetups(result, 2).map((item) => [item.rank, item.hit.symbol]), [
    [1, "CCCUSDT"],
    [2, "BBBUSDT"],
  ]);
});

test("signal category follows Buy/Sell direction even when zone metadata is inconsistent", () => {
  const sell = { ...hit("BTCUSDT", 90, "fresh"), direction: "short" as const, zoneType: "demand" as const };
  const buy = { ...hit("ETHUSDT", 90, "fresh"), direction: "long" as const, zoneType: "supply" as const };
  assert.equal(signalBucket(sell), "supply");
  assert.equal(signalBucket(buy), "demand");
});

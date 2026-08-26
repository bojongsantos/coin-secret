import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { baseAsset, isTradableSignalSymbol, tradableSignalSymbols } from "@/config/symbol-filters";
import {
  formatFundingRate,
  formatOpenInterest,
  parseBinanceDerivatives,
  parseBybitDerivatives,
  parseOkxDerivatives,
} from "@/core/domain/market/derivatives";

test("the base asset is what remains after the quote", () => {
  assert.equal(baseAsset("HOLOUSDT"), "HOLO");
  // The trap: S/USDT ends in the letters of a stablecoin without being one.
  assert.equal(baseAsset("SUSDT"), "S");
  assert.equal(baseAsset("BFUSDUSDT"), "BFUSD");
});

test("pegged and wrapped assets are not scanned", () => {
  for (const symbol of ["USDCUSDT", "FDUSDUSDT", "RLUSDUSDT", "FRAXUSDT", "BFUSDUSDT"]) {
    assert.equal(isTradableSignalSymbol(symbol), false, `${symbol} is a stablecoin pair`);
  }
  for (const symbol of ["WBTCUSDT", "WBETHUSDT", "XAUTUSDT", "PAXGUSDT"]) {
    assert.equal(isTradableSignalSymbol(symbol), false, `${symbol} wraps another asset`);
  }
});

test("assets whose ticker merely resembles a stablecoin are kept", () => {
  // S, W and U are real tokens. Matching on the raw symbol instead of the
  // base would have silently deleted all three.
  for (const symbol of ["SUSDT", "WUSDT", "UUSDT", "USUALUSDT"]) {
    assert.equal(isTradableSignalSymbol(symbol), true, `${symbol} is a tradable asset`);
  }
});

test("a listing that is not a fetchable symbol is dropped", () => {
  // An exchange board can carry a display name rather than a trading pair.
  // Left in, it produces one scan error per sweep and never anything else.
  assert.equal(isTradableSignalSymbol("币安人生USDT"), false);
  assert.equal(isTradableSignalSymbol("BTC-USDT"), false);
  assert.equal(isTradableSignalSymbol("BTCUSDC"), false, "only USDT pairs are scanned");
  assert.equal(isTradableSignalSymbol("USDT"), false, "the quote is not its own pair");
});

test("filtering preserves the board's volume order", () => {
  const kept = tradableSignalSymbols(["BTCUSDT", "USDCUSDT", "ETHUSDT"]);
  assert.deepEqual(kept, ["BTCUSDT", "ETHUSDT"]);
});

test("the shipped watchlist is already clean", () => {
  const rejected = DEFAULT_WATCHLIST.filter((symbol) => !isTradableSignalSymbol(symbol));
  assert.deepEqual(rejected, []);
  assert.ok(DEFAULT_WATCHLIST.length > 150, "the board is still a broad universe");
  assert.equal(new Set(DEFAULT_WATCHLIST).size, DEFAULT_WATCHLIST.length, "no duplicates");
});

test("Binance reports open interest in contracts, so it needs the price", () => {
  const snapshot = parseBinanceDerivatives(
    { lastFundingRate: "0.00012" },
    { openInterest: "80000" },
    78_000,
  );
  assert.ok(snapshot);
  assert.equal(snapshot.fundingRate, 0.00012);
  assert.equal(snapshot.openInterestUsd, 80_000 * 78_000);
  assert.equal(snapshot.source, "binance");
});

test("Bybit reports open interest already in dollars", () => {
  const snapshot = parseBybitDerivatives({
    result: { list: [{ fundingRate: "-0.00005", openInterestValue: "6120000000" }] },
  });
  assert.ok(snapshot);
  assert.equal(snapshot.fundingRate, -0.00005);
  assert.equal(snapshot.openInterestUsd, 6_120_000_000);
});

test("OKX prefers its dollar figure and falls back to the coin count", () => {
  const withUsd = parseOkxDerivatives(
    { data: [{ fundingRate: "0.0001" }] },
    { data: [{ oiCcy: "10000", oiUsd: "900000000" }] },
    78_000,
  );
  assert.equal(withUsd?.openInterestUsd, 900_000_000);

  const withoutUsd = parseOkxDerivatives(
    { data: [{ fundingRate: "0.0001" }] },
    { data: [{ oiCcy: "10000" }] },
    78_000,
  );
  assert.equal(withoutUsd?.openInterestUsd, 780_000_000);
});

test("a half-answer is treated as no answer", () => {
  // The failure this pins: one field arriving alone used to render as a real
  // number beside an em dash, which reads as "the market has no open
  // interest" rather than "this source did not answer".
  assert.equal(parseBinanceDerivatives({}, { openInterest: "80000" }, 78_000), null);
  assert.equal(parseBinanceDerivatives({ lastFundingRate: "0.0001" }, {}, 78_000), null);
  assert.equal(parseBybitDerivatives({ result: { list: [] } }), null);
  assert.equal(parseBybitDerivatives({}), null);
});

test("a figure outside any plausible range is rejected", () => {
  // A source that answers with a percentage where a fraction was expected is
  // worse than one that does not answer at all: it looks authoritative.
  assert.equal(
    parseBybitDerivatives({ result: { list: [{ fundingRate: "12", openInterestValue: "1e9" }] } }),
    null,
  );
  assert.equal(
    parseBybitDerivatives({ result: { list: [{ fundingRate: "0.0001", openInterestValue: "0" }] } }),
    null,
  );
});

test("figures are formatted the way the market quotes them", () => {
  assert.equal(formatFundingRate(0.0001), "0.0100%");
  assert.equal(formatFundingRate(-0.000075), "-0.0075%");
  assert.equal(formatOpenInterest(6_120_000_000), "$6.1B");
  assert.equal(formatOpenInterest(940_000_000), "$940M");
});

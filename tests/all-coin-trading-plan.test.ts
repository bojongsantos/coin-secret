import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { buildAnalysisResult } from "@/core/domain/analysis/analysis-engine";
import { ACTIVE_SETUP_STATUSES, TERMINAL_SETUP_STATUSES } from "@/core/domain/analysis/setup-lifecycle";

test("every watchlist coin renders the selected publication across venues, directions, timeframes and outcomes", () => {
  let checked = 0;
  for (const symbol of DEFAULT_WATCHLIST) for (const timeframe of ["15m", "1H"] as const) {
    const step = timeframe === "15m" ? 900 : 3600;
    const candles = Array.from({ length: 40 }, (_, i) => ({ time: 1_700_000_000 + i * step, open: 102, high: 103, low: 101, close: 102, volume: 1000 }));
    for (const exchange of ["Binance", "Bybit"]) for (const direction of ["long", "short"] as const) {
      for (const status of [...ACTIVE_SETUP_STATUSES, ...TERMINAL_SETUP_STATUSES]) {
        const plan = { direction, entry: 100, stopLoss: direction === "long" ? 90 : 110, target1: direction === "long" ? 110 : 90,
          target2: direction === "long" ? 120 : 80, confidence: 74, zoneTop: 101, zoneBottom: 99, zoneBaseTime: candles[2].time, status };
        const ticker = { symbol, lastPrice: direction === "long" ? 102 : 98, priceChange: 1, priceChangePercent: 1, highPrice: 103, lowPrice: 97, quoteVolume: 1_000_000, volume: 1000 };
        const result = buildAnalysisResult(symbol, symbol.replace(/USDT$/, ""), "USDT", timeframe, exchange, candles, ticker, plan, "en",
          { publishedOnly: true, showPublishedOutcome: true, evaluateLifecycle: false, computePerformance: false });
        const context = `${symbol} ${timeframe} ${exchange} ${direction} ${status}`;
        assert.notEqual(result.pattern.name, "No Zone Setup", context);
        assert.equal(result.pattern.status, status, context);
        assert.equal(result.pattern.confidence, plan.confidence, context);
        assert.deepEqual(result.levels.map(level => level.price), [plan.entry, plan.target1, plan.target2, plan.stopLoss], context);
        checked++;
      }
    }
  }
  assert.equal(checked, DEFAULT_WATCHLIST.length * 2 * 2 * 2 * 7);
});

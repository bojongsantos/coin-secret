import { createFailoverMarketData } from "@/core/application/market-data/failover";
import { pinnedMarketData } from "@/core/application/market-data/source-selection";
import type { MarketDataSource } from "@/core/application/ports/market-data-port";
import type { MarketExchange } from "@/core/domain/market/exchange";
import { binanceMarketData, fetchSpotUsdtSymbols } from "@/infrastructure/market-data/binance-client";
import { bybitMarketData, fetchBybitSpotUsdtSymbols } from "@/infrastructure/market-data/bybit-client";

/**
 * Named spot sources for charts, scanners and published setup lifecycle.
 *
 * New reads prefer Binance and can choose a complete Bybit snapshot. Once a
 * chart or setup has selected a source, later reads must use that named
 * adapter. The compatibility gateway below is never used for lifecycle reads.
 */
export const marketDataSources: readonly MarketDataSource[] = [
  { exchange: "binance", marketData: binanceMarketData },
  { exchange: "bybit", marketData: bybitMarketData },
];

export const marketData = {
  ...createFailoverMarketData([binanceMarketData, bybitMarketData]),
  sources: marketDataSources,
};

export function getMarketDataSource(exchange: MarketExchange) {
  return pinnedMarketData(marketDataSources, exchange);
}

/**
 * Tradable USDT spot symbols. Falls back to Bybit's board when Binance's
 * exchange info is unavailable, so symbol search never comes back empty.
 */
export async function fetchUsdtSymbolCatalog(): Promise<string[]> {
  try {
    return await fetchSpotUsdtSymbols();
  } catch (error) {
    try {
      return await fetchBybitSpotUsdtSymbols();
    } catch {
      throw error instanceof Error ? error : new Error("Symbol catalog unavailable");
    }
  }
}

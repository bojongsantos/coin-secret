import type { Candle, MarketTicker, Timeframe } from "@/core/domain/models";

export interface KlineQuery {
  symbol: string;
  timeframe: Timeframe;
  /** Maximum candles to return. Providers cap this at their own page size. */
  limit?: number;
  signal?: AbortSignal;
  /** Upper bound of the window, in milliseconds. Used to page backwards. */
  endTime?: number;
  /** Lower bound of the window, in milliseconds. Used to page forwards. */
  startTime?: number;
}

export interface MarketDataPort {
  fetchKlines(query: KlineQuery): Promise<Candle[]>;
  fetchTicker24h(symbol: string, signal?: AbortSignal): Promise<MarketTicker>;
  fetchTickers24h(symbols: string[], signal?: AbortSignal): Promise<MarketTicker[]>;
}

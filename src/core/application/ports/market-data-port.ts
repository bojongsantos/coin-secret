import type { Candle, MarketTicker, Timeframe } from "@/core/domain/models";
import type { MarketExchange } from "@/core/domain/market/exchange";

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
  /** Named alternatives, used to choose one complete snapshot rather than mix requests. */
  sources?: readonly MarketDataSource[];
  fetchKlines(query: KlineQuery): Promise<Candle[]>;
  fetchTicker24h(symbol: string, signal?: AbortSignal): Promise<MarketTicker>;
  fetchTickers24h(symbols: string[], signal?: AbortSignal): Promise<MarketTicker[]>;
}

export interface MarketDataSource {
  exchange: MarketExchange | null;
  marketData: MarketDataPort;
}

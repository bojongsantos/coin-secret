import type { KlineQuery, MarketDataPort, MarketDataSource } from "@/core/application/ports/market-data-port";
import type { MarketExchange } from "@/core/domain/market/exchange";
import { isMarketExchange } from "@/core/domain/market/exchange";
import type { Candle, MarketTicker } from "@/core/domain/models";

export type { MarketDataSource } from "@/core/application/ports/market-data-port";

export function sourcesForMarketData(marketData: MarketDataPort): readonly MarketDataSource[] {
  return marketData.sources ?? [{ exchange: null, marketData }];
}

export function pinnedMarketData(sources: readonly MarketDataSource[], exchange: MarketExchange): MarketDataPort {
  const source = sources.find((candidate) => candidate.exchange === exchange);
  if (!source) throw new Error(`${exchange} market data unavailable`);
  return source.marketData;
}

export interface MarketSnapshot extends MarketDataSource {
  ticker: MarketTicker;
  candles: Candle[];
}

type TickerBatch = ReadonlyMap<string, MarketTicker> | (() => Promise<ReadonlyMap<string, MarketTicker>>);

/** Each venue's batch starts only when selected and is shared across symbols. */
export function createTickerBatches(
  sources: readonly MarketDataSource[],
  symbols: string[],
  signal?: AbortSignal,
): ReadonlyMap<MarketDataPort, () => Promise<ReadonlyMap<string, MarketTicker>>> {
  return new Map(sources.map((source) => {
    let pending: Promise<ReadonlyMap<string, MarketTicker>> | undefined;
    return [source.marketData, () => {
      pending ??= Promise.resolve()
        .then(() => source.marketData.fetchTickers24h(symbols, signal))
        .then((tickers) => new Map(tickers.map((ticker) => [ticker.symbol, ticker])));
      return pending;
    }];
  }));
}

/** Unknown provenance cannot establish a new lifecycle or result proof. */
export async function fetchPublishedCandles(
  sources: readonly MarketDataSource[],
  exchange: unknown,
  query: KlineQuery,
): Promise<Candle[]> {
  if (!isMarketExchange(exchange)) throw new Error("Published setup exchange is unknown");
  return pinnedMarketData(sources, exchange).fetchKlines(query);
}

/** A failed half is discarded; the next exchange supplies both halves again. */
export async function loadMarketSnapshot(
  sources: readonly MarketDataSource[],
  query: KlineQuery,
  pinnedExchange?: MarketExchange,
  tickersBySource?: ReadonlyMap<MarketDataPort, TickerBatch>,
): Promise<MarketSnapshot> {
  const candidates = pinnedExchange
    ? sources.filter((source) => source.exchange === pinnedExchange)
    : sources;
  for (const source of candidates) {
    query.signal?.throwIfAborted();
    let batch: ReadonlyMap<string, MarketTicker> | undefined;
    try {
      const stored = tickersBySource?.get(source.marketData);
      batch = typeof stored === "function" ? await stored() : stored;
    } catch {
      // A shared rejected batch benches this venue for the whole scan, rather
      // than causing a fresh failing ticker/candle pair for every symbol.
      query.signal?.throwIfAborted();
      // Unnamed single-provider ports retain their individual-ticker fallback.
      // Production named sources are benched for the remainder of this scan.
      if (source.exchange !== null) continue;
    }
    query.signal?.throwIfAborted();
    const batchedTicker = batch?.get(query.symbol);
    const [candles, ticker] = await Promise.allSettled([
      source.marketData.fetchKlines(query),
      batchedTicker
        ? Promise.resolve(batchedTicker)
        : source.marketData.fetchTicker24h(query.symbol, query.signal),
    ]);
    query.signal?.throwIfAborted();
    if (candles.status === "fulfilled" && candles.value.length > 0 && ticker.status === "fulfilled") {
      return { ...source, candles: candles.value, ticker: ticker.value };
    }
  }
  throw new Error(pinnedExchange ? `${pinnedExchange} market data unavailable` : "Chart market data unavailable");
}

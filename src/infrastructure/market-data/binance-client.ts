import type { KlineQuery, MarketDataPort } from "@/core/application/ports/market-data-port";
import type { Candle, MarketTicker, Timeframe } from "@/core/domain/models";
import { exchangeNumber, requestExchangeJson } from "@/infrastructure/market-data/exchange-http";

export const BINANCE_BASE = "https://data-api.binance.vision";

export const INTERVAL_BY_TIMEFRAME: Record<Timeframe, string> = {
  "15m": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
};

/** Default page size when a caller does not ask for a specific one. */
export const DEFAULT_KLINE_LIMIT = 100;

const LABEL = "Binance";

/** Binance caps klines at 1000 rows per request. */
export const BINANCE_MAX_KLINES = 1_000;

function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestExchangeJson<T>(BINANCE_BASE, path, LABEL, signal);
}

function finiteNumber(value: unknown, field: string): number {
  return exchangeNumber(value, field, LABEL);
}

export async function fetchKlines(query: KlineQuery): Promise<Candle[]> {
  const { symbol, timeframe, signal, endTime, startTime } = query;
  const interval = INTERVAL_BY_TIMEFRAME[timeframe];
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? DEFAULT_KLINE_LIMIT)), BINANCE_MAX_KLINES);
  const window =
    (startTime === undefined ? "" : `&startTime=${Math.floor(startTime)}`) +
    (endTime === undefined ? "" : `&endTime=${Math.floor(endTime)}`);
  const raw = await request<[number, string, string, string, string, string][]>(
    `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}${window}`,
    signal,
  );
  if (!Array.isArray(raw)) throw new Error(`No candle data for ${symbol}`);
  // An empty page is only an error when no window was requested: paging past
  // the edge of available history legitimately returns nothing.
  if (raw.length === 0 && endTime === undefined && startTime === undefined) {
    throw new Error(`No candle data for ${symbol}`);
  }
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: finiteNumber(k[1], "open"),
    high: finiteNumber(k[2], "high"),
    low: finiteNumber(k[3], "low"),
    close: finiteNumber(k[4], "close"),
    volume: finiteNumber(k[5], "volume"),
  }));
}

export async function fetchTicker24h(symbol: string, signal?: AbortSignal): Promise<MarketTicker> {
  const t = await request<Record<string, string>>(
    `/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`,
    signal,
  );
  return {
    symbol: t.symbol,
    lastPrice: finiteNumber(t.lastPrice, "lastPrice"),
    priceChange: finiteNumber(t.priceChange, "priceChange"),
    priceChangePercent: finiteNumber(t.priceChangePercent, "priceChangePercent"),
    highPrice: finiteNumber(t.highPrice, "highPrice"),
    lowPrice: finiteNumber(t.lowPrice, "lowPrice"),
    quoteVolume: finiteNumber(t.quoteVolume, "quoteVolume"),
    volume: finiteNumber(t.volume, "volume"),
  };
}

export async function fetchTickers24h(symbols: string[], signal?: AbortSignal): Promise<MarketTicker[]> {
  if (symbols.length === 0) return [];
  // Binance caps the number of symbols per request; chunk large lists.
  const chunk = 80;
  const out: MarketTicker[] = [];
  for (let i = 0; i < symbols.length; i += chunk) {
    const slice = symbols.slice(i, i + chunk);
    const symbolParam = slice.map((s) => `"${s}"`).join(",");
    const list = await request<Record<string, string>[]>(`/api/v3/ticker/24hr?symbols=[${symbolParam}]`, signal);
    out.push(
      ...list.map((t) => ({
        symbol: t.symbol,
        lastPrice: finiteNumber(t.lastPrice, "lastPrice"),
        priceChange: finiteNumber(t.priceChange, "priceChange"),
        priceChangePercent: finiteNumber(t.priceChangePercent, "priceChangePercent"),
        highPrice: finiteNumber(t.highPrice, "highPrice"),
        lowPrice: finiteNumber(t.lowPrice, "lowPrice"),
        quoteVolume: finiteNumber(t.quoteVolume, "quoteVolume"),
        volume: finiteNumber(t.volume, "volume"),
      })),
    );
  }
  return out;
}

interface BinanceExchangeSymbol {
  symbol: string;
  status: string;
  quoteAsset: string;
  isSpotTradingAllowed?: boolean;
}

export async function fetchSpotUsdtSymbols(): Promise<string[]> {
  const exchange = await request<{ symbols: BinanceExchangeSymbol[] }>("/api/v3/exchangeInfo");
  return exchange.symbols
    .filter((item) =>
      item.status === "TRADING" &&
      item.quoteAsset === "USDT" &&
      item.isSpotTradingAllowed !== false &&
      /^[A-Z0-9]{4,20}$/.test(item.symbol),
    )
    .map((item) => item.symbol);
}

export const binanceMarketData: MarketDataPort = {
  fetchKlines,
  fetchTicker24h,
  fetchTickers24h,
};

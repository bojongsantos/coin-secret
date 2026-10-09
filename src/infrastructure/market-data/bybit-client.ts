import type { KlineQuery, MarketDataPort } from "@/core/application/ports/market-data-port";
import type { Candle, MarketTicker, Timeframe } from "@/core/domain/models";
import { exchangeNumber, requestExchangeJson } from "@/infrastructure/market-data/exchange-http";

export const BYBIT_BASE = "https://api.bybit.com";

const LABEL = "Bybit";

/** Bybit expresses minutes as plain numbers and days as "D". */
export const BYBIT_INTERVAL_BY_TIMEFRAME: Record<Timeframe, string> = {
  "15m": "15",
  "1H": "60",
  "4H": "240",
  "1D": "D",
};

/** Bybit caps spot klines at 1000 rows per request, same as Binance. */
export const BYBIT_MAX_KLINES = 1_000;

interface BybitEnvelope<T> {
  retCode?: number;
  retMsg?: string;
  result?: T;
}

interface BybitTickerRow {
  symbol?: string;
  lastPrice?: string;
  prevPrice24h?: string;
  price24hPcnt?: string;
  highPrice24h?: string;
  lowPrice24h?: string;
  turnover24h?: string;
  volume24h?: string;
}

async function bybitRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const envelope = await requestExchangeJson<BybitEnvelope<T>>(BYBIT_BASE, path, LABEL, signal);
  if (envelope.retCode !== 0 || !envelope.result) {
    throw new Error(`${LABEL} error ${envelope.retCode ?? "unknown"}: ${envelope.retMsg ?? "no result"}`);
  }
  return envelope.result;
}

/** Maps one Bybit ticker row onto the shared MarketTicker shape. */
function toTicker(row: BybitTickerRow): MarketTicker {
  const lastPrice = exchangeNumber(row.lastPrice, "lastPrice", LABEL);
  const previous = exchangeNumber(row.prevPrice24h, "prevPrice24h", LABEL);
  // Bybit reports the 24h move as a ratio (0.0126), not a percentage.
  const changeRatio = exchangeNumber(row.price24hPcnt, "price24hPcnt", LABEL);
  return {
    symbol: String(row.symbol ?? ""),
    lastPrice,
    priceChange: lastPrice - previous,
    priceChangePercent: changeRatio * 100,
    highPrice: exchangeNumber(row.highPrice24h, "highPrice24h", LABEL),
    lowPrice: exchangeNumber(row.lowPrice24h, "lowPrice24h", LABEL),
    quoteVolume: exchangeNumber(row.turnover24h, "turnover24h", LABEL),
    volume: exchangeNumber(row.volume24h, "volume24h", LABEL),
  };
}

export async function fetchBybitKlines(query: KlineQuery): Promise<Candle[]> {
  const { symbol, timeframe, signal, endTime, startTime } = query;
  const interval = BYBIT_INTERVAL_BY_TIMEFRAME[timeframe];
  const capped = Math.min(Math.max(1, Math.floor(query.limit ?? 200)), BYBIT_MAX_KLINES);
  const window =
    (startTime === undefined ? "" : `&start=${Math.floor(startTime)}`) +
    (endTime === undefined ? "" : `&end=${Math.floor(endTime)}`);
  const result = await bybitRequest<{ list?: string[][] }>(
    `/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${capped}${window}`,
    signal,
  );
  const rows = result.list ?? [];
  if (rows.length === 0 && endTime === undefined && startTime === undefined) {
    throw new Error(`No candle data for ${symbol}`);
  }
  // Bybit returns newest first; the rest of the app assumes ascending time.
  return rows
    .map((row) => ({
      time: Math.floor(exchangeNumber(row[0], "startTime", LABEL) / 1000),
      open: exchangeNumber(row[1], "open", LABEL),
      high: exchangeNumber(row[2], "high", LABEL),
      low: exchangeNumber(row[3], "low", LABEL),
      close: exchangeNumber(row[4], "close", LABEL),
      volume: exchangeNumber(row[5], "volume", LABEL),
    }))
    .sort((a, b) => a.time - b.time);
}

export async function fetchBybitTicker24h(
  symbol: string,
  signal?: AbortSignal,
): Promise<MarketTicker> {
  const result = await bybitRequest<{ list?: BybitTickerRow[] }>(
    `/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`,
    signal,
  );
  const row = result.list?.[0];
  if (!row) throw new Error(`No ticker data for ${symbol}`);
  return toTicker(row);
}

export async function fetchBybitTickers24h(symbols: string[], signal?: AbortSignal): Promise<MarketTicker[]> {
  if (symbols.length === 0) return [];
  // Bybit has no multi-symbol filter, so pull the spot board once and select.
  const result = await bybitRequest<{ list?: BybitTickerRow[] }>("/v5/market/tickers?category=spot", signal);
  const wanted = new Set(symbols);
  const out: MarketTicker[] = [];
  for (const row of result.list ?? []) {
    if (!row.symbol || !wanted.has(row.symbol)) continue;
    try {
      out.push(toTicker(row));
    } catch {
      // A single malformed row must not void the whole board.
    }
  }
  return out;
}

export async function fetchBybitSpotUsdtSymbols(): Promise<string[]> {
  const result = await bybitRequest<{ list?: { symbol?: string; status?: string; quoteCoin?: string }[] }>(
    "/v5/market/instruments-info?category=spot",
  );
  return (result.list ?? [])
    .filter(
      (item) =>
        item.status === "Trading" &&
        item.quoteCoin === "USDT" &&
        typeof item.symbol === "string" &&
        /^[A-Z0-9]{4,20}$/.test(item.symbol),
    )
    .map((item) => item.symbol as string);
}

export const bybitMarketData: MarketDataPort = {
  fetchKlines: fetchBybitKlines,
  fetchTicker24h: fetchBybitTicker24h,
  fetchTickers24h: fetchBybitTickers24h,
};

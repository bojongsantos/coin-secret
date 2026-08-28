import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import { emaSeries, rsiSeries } from "@/core/domain/analysis/analysis-engine";
import {
  detectSupplyDemand,
  readPublishedSetup,
  ZONE_SCAN_WINDOW,
} from "@/core/domain/analysis/supply-demand";
import type { ScannerOpportunity, Timeframe } from "@/core/domain/models";
import { mapConcurrent } from "@/shared/lib/async";

const SCAN_TIMEFRAME: Timeframe = "15m";

export interface ScanResult {
  opportunities: ScannerOpportunity[];
  total: number;
  scannedAt: string;
  errors: string[];
}

function sparkline(candles: { close: number }[], points = 14): number[] {
  const n = candles.length;
  const step = Math.max(1, Math.floor(n / points));
  const out: number[] = [];
  for (let i = n - points * step; i < n; i += step) {
    if (i >= 0) out.push(candles[i].close);
  }
  while (out.length < points) out.push(candles[candles.length - 1]?.close ?? 0);
  return out;
}

export interface ScannerOptions {
  /** Where published setups live; see `runSdScan` for why this matters. */
  activeSetups?: ActiveSetupPort;
}

/**
 * The opportunities board.
 *
 * Reads the same published setups the signals table does. Detecting for itself
 * meant this page could call a symbol a short at 77% while the dashboard,
 * looking at the plan actually published for it, called it a filled long at
 * 51%. Two scanners are already one too many; two answers is worse.
 */
export async function runScanner(
  marketData: MarketDataPort,
  symbols: string[],
  options: ScannerOptions = {},
): Promise<ScanResult> {
  const errors: string[] = [];
  const stored = options.activeSetups
    ? await options.activeSetups.loadActive(symbols).catch(() => [] as ActiveSetup[])
    : [];
  const active = new Map(stored.map((entry) => [entry.symbol, entry]));
  let tickers;
  try {
    tickers = await marketData.fetchTickers24h(symbols);
  } catch {
    const individual = await Promise.allSettled(
      symbols.map((symbol) => marketData.fetchTicker24h(symbol)),
    );
    tickers = individual
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<MarketDataPort["fetchTicker24h"]>>
        > => result.status === "fulfilled",
      )
      .map((result) => result.value);
  }

  const tickerMap = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
  const results = await mapConcurrent(
    symbols,
    async (symbol, idx) => {
      try {
        const ticker = tickerMap.get(symbol);
        if (!ticker) throw new Error(`No ticker for ${symbol}`);
        // A published setup is read on its own chart, so this page cannot
        // disagree with the board about which trade a symbol is carrying.
        const held = active.get(symbol);
        const timeframe = held?.timeframe ?? SCAN_TIMEFRAME;
        const candles = await marketData.fetchKlines({ symbol, timeframe, limit: ZONE_SCAN_WINDOW });
        const sd = detectSupplyDemand(candles);
        const published = held
          ? readPublishedSetup(candles, held, candles[candles.length - 1]?.close ?? held.entry).setup
          : null;
        const setup = published ?? sd.setup;
        if (!setup) return null;

        const price = ticker.lastPrice;
        const base = symbol.replace(/USDT$/, "");
        const closes = candles.map((candle) => candle.close);
        const last = candles.at(-1);
        const ema20 = emaSeries(closes, 20).at(-1) ?? price;
        const ema50 = emaSeries(closes, 50).at(-1) ?? price;
        const rsi = rsiSeries(closes, 14).at(-1) ?? 50;
        const recentVolume = candles.slice(-20);
        const averageVolume =
          recentVolume.reduce((sum, candle) => sum + candle.volume, 0) /
          Math.max(1, recentVolume.length);
        const volumeRatio = last ? last.volume / Math.max(1, averageVolume) : 0;

        return {
          value: {
            rank: idx + 1,
            pair: {
              symbol,
              base,
              quote: "USDT",
              name: base,
              price,
              change24h: ticker.priceChangePercent,
            },
            confidence: setup.confidence,
            pattern: setup.zone.type === "demand" ? "Demand Zone" : "Supply Zone",
            timeframe,
            setup: setup.direction,
            sparkline: sparkline(candles),
            status: setup.status || "Limit Order",
            rsi,
            ema20,
            ema50,
            volumeRatio,
            entry: setup.entry,
            support: sd.support,
            resistance: sd.resistance,
            zoneTop: setup.zone.top,
            zoneBottom: setup.zone.bottom,
            narrowness: setup.zone.narrowness,
            strength: setup.zone.strength,
            touches: setup.zone.touches,
          } satisfies ScannerOpportunity,
          error: null,
          symbol,
        };
      } catch (error) {
        return { value: null, error, symbol };
      }
    },
    8,
  );

  const opportunities: ScannerOpportunity[] = [];
  results.forEach((result) => {
    if (!result) return;
    if (result.value) opportunities.push(result.value);
    if (result.error) {
      errors.push(
        `${result.symbol}: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
      );
    }
  });

  opportunities.sort((a, b) => b.confidence - a.confidence);
  opportunities.forEach((opportunity, index) => {
    opportunity.rank = index + 1;
  });

  return {
    opportunities,
    total: opportunities.length,
    scannedAt: new Date().toISOString(),
    errors,
  };
}

const SCANNER_CACHE_TTL_MS = 60_000;
let scannerCache: { key: string; timestamp: number; result: ScanResult } | null = null;
let scannerInFlight: { key: string; promise: Promise<ScanResult> } | null = null;

export function runScannerCached(
  marketData: MarketDataPort,
  symbols: string[],
  force = false,
  options: ScannerOptions = {},
): Promise<ScanResult> {
  const key = symbols.join(",");
  if (
    !force &&
    scannerCache?.key === key &&
    Date.now() - scannerCache.timestamp < SCANNER_CACHE_TTL_MS
  ) {
    return Promise.resolve(scannerCache.result);
  }
  if (!force && scannerInFlight?.key === key) return scannerInFlight.promise;

  const promise = runScanner(marketData, symbols, options)
    .then((result) => {
      scannerCache = { key, timestamp: Date.now(), result };
      return result;
    })
    .finally(() => {
      if (scannerInFlight?.promise === promise) scannerInFlight = null;
    });
  scannerInFlight = { key, promise };
  return promise;
}

import type { ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import { createTickerBatches, loadMarketSnapshot, sourcesForMarketData } from "@/core/application/market-data/source-selection";
import { createScanCache } from "@/core/application/scanner/scan-cache";
import { emaSeries, rsiSeries } from "@/core/domain/analysis/analysis-engine";
import {
  detectSupplyDemand,
  publishedScanLimit,
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
  const sources = sourcesForMarketData(marketData);
  const stored = options.activeSetups
    ? await options.activeSetups.loadActive(symbols)
    : [];
  const active = new Map(stored.map((entry) => [entry.symbol, entry]));
  const tickersBySource = createTickerBatches(sources, symbols);
  const results = await mapConcurrent(
    symbols,
    async (symbol, idx) => {
      try {
        // A published setup is read on its own chart, so this page cannot
        // disagree with the board about which trade a symbol is carrying.
        const held = active.get(symbol);
        const timeframe = held?.timeframe ?? SCAN_TIMEFRAME;
        // A held plan is replayed from the bar its zone formed on, so the
        // window has to reach that far back; without it this page read the
        // same setup differently from the board.
        const limit = held ? publishedScanLimit(held.zoneBaseTime, timeframe) : ZONE_SCAN_WINDOW;
        const { candles, ticker } = await loadMarketSnapshot(sources, { symbol, timeframe, limit }, held?.exchange ?? undefined, tickersBySource);
        const sd = detectSupplyDemand(candles);
        const published = held
          ? readPublishedSetup(candles, held, candles[candles.length - 1]?.close ?? held.entry, { evaluateLifecycle: held.exchange !== null }).setup
          : null;
        // A missing/finished held plan is not permission to substitute a newly
        // detected trade on this board before the publisher commits it.
        const setup = held ? published : sd.setup;
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

const cachedScan = createScanCache<ScanResult>(60_000);

export function runScannerCached(
  marketData: MarketDataPort,
  symbols: string[],
  force = false,
  options: ScannerOptions = {},
): Promise<ScanResult> {
  return cachedScan(marketData, symbols, force, options.activeSetups, () => runScanner(marketData, symbols, options));
}

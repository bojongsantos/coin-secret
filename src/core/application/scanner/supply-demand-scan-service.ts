import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import {
  ACTIVE_SETUP_STATUSES,
  detectSupplyDemand,
  ZONE_SCAN_WINDOW,
  type SdResult,
} from "@/core/domain/analysis/supply-demand";
import type { Timeframe } from "@/core/domain/models";
import { mapConcurrent } from "@/shared/lib/async";

export const SD_SCAN_TIMEFRAME: Timeframe = "15m";

export interface SdScanHit {
  symbol: string;
  base: string;
  timeframe: Timeframe;
  zoneType: "supply" | "demand";
  strength: string;
  confidence: number;
  direction: "long" | "short";
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  /** Open time of the bar the zone formed on — the setup's stable identity. */
  zoneBaseTime: number;
  zoneTop: number;
  zoneBottom: number;
  change24h: number;
  volume24h: number;
  zones: number;
  status?: string;
}

export interface SdMarketSnapshot {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  sparkline: number[];
}

export interface SdScanResult {
  demand: SdScanHit[];
  supply: SdScanHit[];
  market: SdMarketSnapshot[];
  demandTotal: number;
  supplyTotal: number;
  scannedAt: string;
  errors: string[];
}

export function signalBucket(hit: Pick<SdScanHit, "direction">): "demand" | "supply" {
  return hit.direction === "long" ? "demand" : "supply";
}

export async function runSdScan(
  marketData: MarketDataPort,
  symbols: string[],
): Promise<SdScanResult> {
  const errors: string[] = [];
  const tickers = await marketData.fetchTickers24h(symbols).catch(() => []);
  const tickerMap = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
  const sparklineMap = new Map<string, number[]>();
  const demand: SdScanHit[] = [];
  const supply: SdScanHit[] = [];

  await mapConcurrent(
    symbols,
    async (symbol) => {
      try {
        const candles = await marketData.fetchKlines({ symbol, timeframe: SD_SCAN_TIMEFRAME, limit: ZONE_SCAN_WINDOW });
        sparklineMap.set(symbol, candles.slice(-96).map((candle) => candle.close));
        const sd: SdResult = detectSupplyDemand(candles);
        if (!sd.setup) return;

        const setup = sd.setup;
        if (
          !ACTIVE_SETUP_STATUSES.includes(
            setup.status as (typeof ACTIVE_SETUP_STATUSES)[number],
          )
        ) {
          return;
        }

        const ticker = tickerMap.get(symbol);
        const hit: SdScanHit = {
          symbol,
          base: symbol.replace(/USDT$/, "") || symbol,
          timeframe: SD_SCAN_TIMEFRAME,
          zoneType: setup.zone.type,
          strength: setup.zone.strength,
          confidence: setup.confidence,
          direction: setup.direction,
          entry: setup.entry,
          target1: setup.target1,
          target2: setup.target2,
          stopLoss: setup.stopLoss,
          zoneBaseTime: setup.zone.baseTime,
          zoneTop: setup.zone.top,
          zoneBottom: setup.zone.bottom,
          change24h: ticker?.priceChangePercent ?? 0,
          volume24h: ticker?.quoteVolume ?? 0,
          zones: sd.zones.length,
          status: setup.status,
        };
        if (signalBucket(hit) === "demand") demand.push(hit);
        else supply.push(hit);
      } catch (error) {
        errors.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    8,
  );

  const byVolume = (a: SdScanHit, b: SdScanHit) => b.volume24h - a.volume24h;
  demand.sort(byVolume);
  supply.sort(byVolume);

  return {
    demand,
    supply,
    market: tickers.map((ticker) => ({
      symbol: ticker.symbol,
      price: ticker.lastPrice,
      change24h: ticker.priceChangePercent,
      volume24h: ticker.quoteVolume,
      sparkline: sparklineMap.get(ticker.symbol) ?? [],
    })),
    demandTotal: demand.length,
    supplyTotal: supply.length,
    scannedAt: new Date().toISOString(),
    errors,
  };
}

export interface TopSetup {
  hit: SdScanHit;
  rank: number;
}

export function rankTopSetups(result: SdScanResult, limit = 5): TopSetup[] {
  const all = [...result.demand, ...result.supply];
  const live = (hit: SdScanHit) =>
    ACTIVE_SETUP_STATUSES.includes(hit.status as (typeof ACTIVE_SETUP_STATUSES)[number]);
  const qualified = all.filter((hit) => live(hit) && hit.strength === "fresh");
  const livePool = qualified.length > 0 ? qualified : all.filter(live);
  const ranked = livePool.length > 0 ? livePool : all;

  // Confidence is the only score the detector produces; Setup Score used to be
  // the same number rescaled, which made the ranking look like it weighed two
  // signals when it never did.
  ranked.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.volume24h - a.volume24h;
  });

  return ranked.slice(0, limit).map((hit, index) => ({ hit, rank: index + 1 }));
}

const SD_CACHE_TTL_MS = 60_000;
let sdCache: { key: string; timestamp: number; result: SdScanResult } | null = null;
let sdInFlight: { key: string; promise: Promise<SdScanResult> } | null = null;

export function runSdScanCached(
  marketData: MarketDataPort,
  symbols: string[],
  force = false,
): Promise<SdScanResult> {
  const key = symbols.join(",");
  if (!force && sdCache?.key === key && Date.now() - sdCache.timestamp < SD_CACHE_TTL_MS) {
    return Promise.resolve(sdCache.result);
  }
  if (!force && sdInFlight?.key === key) return sdInFlight.promise;

  const promise = runSdScan(marketData, symbols)
    .then((result) => {
      sdCache = { key, timestamp: Date.now(), result };
      return result;
    })
    .finally(() => {
      if (sdInFlight?.promise === promise) sdInFlight = null;
    });
  sdInFlight = { key, promise };
  return promise;
}

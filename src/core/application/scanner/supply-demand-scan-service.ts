import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import {
  ACTIVE_SETUP_STATUSES,
  detectSupplyDemand,
  readPublishedSetup,
  ZONE_SCAN_WINDOW,
  type SdResult,
} from "@/core/domain/analysis/supply-demand";
import type { Candle, Timeframe } from "@/core/domain/models";
import { mapConcurrent } from "@/shared/lib/async";

/** The timeframe a symbol's sparkline and 24h figures are drawn from. */
export const SD_SCAN_TIMEFRAME: Timeframe = "15m";

/**
 * Timeframes the scanner looks for setups on.
 *
 * Held to the two fastest charts on purpose. A setup on the daily can sit
 * unresolved for a week before anyone learns whether it was right, which buys
 * a slower read at the cost of most of the board being unactionable; the
 * product is worth more with more setups that settle inside a session.
 *
 * Ordered slowest-first so the tie-break below prefers the timeframe that took
 * longer to form.
 */
export const SD_SETUP_TIMEFRAMES: readonly Timeframe[] = ["1H", "15m"];

/**
 * Ranks two candidates for the same symbol.
 *
 * Confidence decides it. When two timeframes agree that closely, the slower
 * one is the sturdier read — it is built from more market and invalidates
 * less often — so `SD_SETUP_TIMEFRAMES` order breaks the tie.
 */
function betterCandidate(a: SdScanHit, b: SdScanHit): SdScanHit {
  if (b.confidence !== a.confidence) return b.confidence > a.confidence ? b : a;
  return SD_SETUP_TIMEFRAMES.indexOf(b.timeframe) < SD_SETUP_TIMEFRAMES.indexOf(a.timeframe) ? b : a;
}

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
  status: string;
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

/** Turns a detected or stored setup into a table row. */
function toHit(
  input: {
    symbol: string;
    timeframe: Timeframe;
    zoneType: "supply" | "demand";
    strength: string;
    confidence: number;
    direction: SdScanHit["direction"];
    entry: number;
    target1: number;
    target2: number;
    stopLoss: number;
    zoneBaseTime: number;
    zoneTop: number;
    zoneBottom: number;
    zones: number;
    status: string;
  },
  ticker: { priceChangePercent: number; quoteVolume: number } | undefined,
): SdScanHit {
  return {
    ...input,
    base: input.symbol.replace(/USDT$/, "") || input.symbol,
    change24h: ticker?.priceChangePercent ?? 0,
    volume24h: ticker?.quoteVolume ?? 0,
  };
}

export interface SdScanOptions {
  /**
   * Where published setups live.
   *
   * Without it the scan is stateless and picks the best zone it can see, which
   * is the behaviour that replaced live trading plans on every refresh.
   */
  activeSetups?: ActiveSetupPort;
}

/**
 * One pass over the board.
 *
 * A symbol that already carries a published setup is re-read, never
 * re-chosen: its stored levels are what the reader is trading, and only price
 * may change its status. Only once price has finished the setup — target,
 * stop, or missed — is the symbol free to carry a new one.
 */
export async function runSdScan(
  marketData: MarketDataPort,
  symbols: string[],
  options: SdScanOptions = {},
): Promise<SdScanResult> {
  const errors: string[] = [];
  const tickers = await marketData.fetchTickers24h(symbols).catch(() => []);
  const tickerMap = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
  const sparklineMap = new Map<string, number[]>();
  const demand: SdScanHit[] = [];
  const supply: SdScanHit[] = [];
  const changed: ActiveSetup[] = [];

  const stored = options.activeSetups
    ? await options.activeSetups.loadActive(symbols).catch(() => [] as ActiveSetup[])
    : [];
  const active = new Map(stored.map((entry) => [entry.symbol, entry]));

  await mapConcurrent(
    symbols,
    async (symbol) => {
      try {
        // The sparkline and the 24h figures always come from the fast chart,
        // whatever timeframe the setup itself lives on.
        const fast = await marketData.fetchKlines({
          symbol,
          timeframe: SD_SCAN_TIMEFRAME,
          limit: ZONE_SCAN_WINDOW,
        });
        sparklineMap.set(symbol, fast.slice(-96).map((candle) => candle.close));

        const held = active.get(symbol);
        // A setup on a timeframe the scanner no longer reads is let go rather
        // than nursed to its conclusion: the board exists to show what can be
        // acted on now, and nothing else would ever refresh those symbols.
        if (held && SD_SETUP_TIMEFRAMES.includes(held.timeframe)) {
          const candles =
            held.timeframe === SD_SCAN_TIMEFRAME
              ? fast
              : await marketData.fetchKlines({
                  symbol,
                  timeframe: held.timeframe,
                  limit: ZONE_SCAN_WINDOW,
                });
          const price = candles[candles.length - 1]?.close ?? held.entry;
          const reading = readPublishedSetup(candles, held, price);
          if (reading.status !== held.status) changed.push({ ...held, status: reading.status });

          const setup = reading.setup;
          if (setup) {
            const hit = toHit(
              {
                symbol,
                timeframe: held.timeframe,
                zoneType: setup.zone.type,
                strength: setup.zone.strength,
                confidence: setup.confidence,
                direction: setup.direction,
                entry: setup.entry,
                target1: setup.target1,
                target2: setup.target2,
                stopLoss: setup.stopLoss,
                zoneBaseTime: held.zoneBaseTime,
                zoneTop: setup.zone.top,
                zoneBottom: setup.zone.bottom,
                zones: 1,
                status: setup.status,
              },
              tickerMap.get(symbol),
            );
            if (signalBucket(hit) === "demand") demand.push(hit);
            else supply.push(hit);
            return;
          }
          // Finished. The symbol is free to carry a new setup again.
        }

        // Nothing held: look across every timeframe and take the best read.
        let best: SdScanHit | null = null;
        for (const timeframe of SD_SETUP_TIMEFRAMES) {
          const candles =
            timeframe === SD_SCAN_TIMEFRAME
              ? fast
              : await marketData
                  .fetchKlines({ symbol, timeframe, limit: ZONE_SCAN_WINDOW })
                  .catch(() => [] as Candle[]);
          if (candles.length === 0) continue;

          const sd: SdResult = detectSupplyDemand(candles);
          const setup = sd.setup;
          if (!setup) continue;
          if (!ACTIVE_SETUP_STATUSES.includes(setup.status as (typeof ACTIVE_SETUP_STATUSES)[number])) {
            continue;
          }

          const candidate = toHit(
            {
              symbol,
              timeframe,
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
              zones: sd.zones.length,
              status: setup.status,
            },
            tickerMap.get(symbol),
          );
          best = best === null ? candidate : betterCandidate(best, candidate);
        }

        if (!best) return;
        changed.push({
          symbol: best.symbol,
          timeframe: best.timeframe,
          direction: best.direction,
          entry: best.entry,
          target1: best.target1,
          target2: best.target2,
          stopLoss: best.stopLoss,
          confidence: best.confidence,
          zoneTop: best.zoneTop,
          zoneBottom: best.zoneBottom,
          zoneBaseTime: best.zoneBaseTime,
          status: best.status,
        });
        if (signalBucket(best) === "demand") demand.push(best);
        else supply.push(best);
      } catch (error) {
        errors.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    8,
  );

  if (options.activeSetups && changed.length > 0) {
    await options.activeSetups.persist(changed).catch(() => {
      // The scan is still valid without the write; the next run retries it.
    });
  }

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
  const live = all.filter((hit) =>
    ACTIVE_SETUP_STATUSES.includes(hit.status as (typeof ACTIVE_SETUP_STATUSES)[number]),
  );
  const pool = live.length > 0 ? live : all;

  // Confidence decides, and freshness only separates a tie. It used to be a
  // gate: setups had to be "fresh" to be ranked at all. Once published setups
  // began carrying their own state they all read as "tested", so the gate
  // emptied the pool and a strip promising five names showed two.
  const ranked = [...pool].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const freshness = Number(b.strength === "fresh") - Number(a.strength === "fresh");
    if (freshness !== 0) return freshness;
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
  options: SdScanOptions = {},
): Promise<SdScanResult> {
  const key = symbols.join(",");
  if (!force && sdCache?.key === key && Date.now() - sdCache.timestamp < SD_CACHE_TTL_MS) {
    return Promise.resolve(sdCache.result);
  }
  if (!force && sdInFlight?.key === key) return sdInFlight.promise;

  const promise = runSdScan(marketData, symbols, options)
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

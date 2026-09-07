import type { Candle, SetupDirection, Timeframe } from "@/core/domain/models";
import { TIMEFRAME_SECONDS } from "@/core/domain/market/timeframe";
import {
  isTerminalSetupStatus,
  traceSetupLifecycle,
  type SetupStatus as Status,
} from "@/core/domain/analysis/setup-lifecycle";
import { formatPrice } from "@/shared/lib/format";

export type ZoneType = "supply" | "demand";
export type ZoneStrength = "fresh" | "tested" | "broken";

export interface SdZone {
  id: string;
  type: ZoneType;
  top: number;
  bottom: number;
  /** Candle index where the zone's base starts. */
  baseIndex: number;
  baseTime: number;
  /** How many times price has revisited the zone. */
  touches: number;
  strength: ZoneStrength;
  /** Whether price currently sits inside the zone. */
  active: boolean;
  /** Confidence 0..100 — fresh + narrow + unbroken zones score higher. */
  confidence: number;
  /** Zone width relative to the average range (0 = wide, 1 = razor thin). */
  narrowness: number;
}

export interface SdSetup {
  direction: SetupDirection;
  zone: SdZone;
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  riskReward: number;
  confidence: number;
  status: string;
  reasoning: string[];
}

export interface SdResult {
  zones: SdZone[];
  setup: SdSetup | null;
  bias: "bullish" | "bearish" | "neutral";
  support: number;
  resistance: number;
}

export type { SetupStatus } from "@/core/domain/analysis/setup-lifecycle";
export {
  ACTIVE_SETUP_STATUSES,
  isTerminalSetupStatus,
  TERMINAL_SETUP_STATUSES,
} from "@/core/domain/analysis/setup-lifecycle";

const SWING_RADIUS = 2;
const SWING_LOOKBACK = 50;

/**
 * Trailing candles searched for zones.
 *
 * Bounded here rather than left to each caller, because the scanner and the
 * analysis page hand in different amounts of history. Scanning whatever they
 * happened to fetch made the two disagree about the same market: the signals
 * table could advertise a limit order while the chart showed no setup at all.
 * Every caller must supply at least this many candles for the results to line
 * up; supplying more is harmless and leaves the extra bars for the chart.
 */
export const ZONE_SCAN_WINDOW = 300;

const STOP_BUFFER_RATIO = 0.001;

/**
 * Places the protective stop beyond the latest confirmed swing and never
 * inside the setup zone. Long setups use a swing low; shorts use a swing high.
 */
export function findSwingStopLoss(
  candles: Candle[],
  direction: SetupDirection,
  zoneBoundary: number,
): number {
  const firstIndex = Math.max(SWING_RADIUS, candles.length - SWING_LOOKBACK);
  const lastIndex = candles.length - SWING_RADIUS - 1;
  let swing: number | null = null;

  for (let index = lastIndex; index >= firstIndex; index -= 1) {
    const pivot = candles[index];
    const neighbours = candles.slice(index - SWING_RADIUS, index).concat(
      candles.slice(index + 1, index + SWING_RADIUS + 1),
    );

    if (direction === "long") {
      const isSwingLow = neighbours.every((item) => pivot.low <= item.low)
        && neighbours.some((item) => pivot.low < item.low);
      if (isSwingLow) {
        swing = pivot.low;
        break;
      }
    } else {
      const isSwingHigh = neighbours.every((item) => pivot.high >= item.high)
        && neighbours.some((item) => pivot.high > item.high);
      if (isSwingHigh) {
        swing = pivot.high;
        break;
      }
    }
  }

  const reference = direction === "long"
    ? Math.min(swing ?? zoneBoundary, zoneBoundary)
    : Math.max(swing ?? zoneBoundary, zoneBoundary);

  return direction === "long"
    ? reference * (1 - STOP_BUFFER_RATIO)
    : reference * (1 + STOP_BUFFER_RATIO);
}

export function buildRiskTargets(
  entry: number,
  stopLoss: number,
  direction: SetupDirection,
): { target1: number; target2: number } {
  const risk = Math.abs(entry - stopLoss);
  return direction === "long"
    ? { target1: entry + risk, target2: entry + risk * 2 }
    : { target1: entry - risk, target2: entry - risk * 2 };
}

/**
 * Supply & Demand detection.
 *
 * A zone is the *base* — a short consolidation before a sharp expansion
 * (impulse) candle. The base's high/low bounds the zone. Price returning into
 * an untouched (fresh) zone marks a high-quality entry; tested zones weaken,
 * broken zones are discarded.
 *
 * A setup moves through a state machine:
 *   Limit Order -> Filled -> Running -> (Target 2 reached | Invalidated)
 *   Limit Order -> Missed (price ran through T1 without ever filling entry)
 *
 * The result is a pure function of the candles handed in. It used to consult a
 * per-browser lock that froze a Running setup's levels, which meant the same
 * symbol could show one plan on the chart and a different one in the signals
 * table on the very same screen — and a third to anyone on another device.
 * One deterministic reading is worth more than frozen levels — which is also
 * why it no longer takes a symbol or a timeframe: nothing about the answer may
 * depend on which caller is asking.
 */
export function detectSupplyDemand(candles: Candle[]): SdResult {
  const zones: SdZone[] = [];

  // Average candle range used to detect an "impulse" (expansion) candle.
  const avgRange =
    candles.slice(-40).reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, Math.min(40, candles.length));
  const impulseFactor = 1.6;

  const scanStart = Math.max(2, candles.length - ZONE_SCAN_WINDOW);
  for (let i = scanStart; i < candles.length - 1; i++) {
    const baseStart = i - 2; // up to 2 candles of base before the impulse
    const impulse = candles[i];
    const impulseRange = impulse.high - impulse.low;
    const isExpansion = impulseRange > avgRange * impulseFactor;

    // A sharp downward expansion breaks the prior base low → supply above.
    const isSupplyImpulse =
      isExpansion &&
      impulse.close < impulse.open &&
      impulse.close < candles[i - 1].low &&
      impulse.high < candles[baseStart].high * 1.02;
    // A sharp upward expansion breaks the prior base high → demand below.
    const isDemandImpulse =
      isExpansion &&
      impulse.close > impulse.open &&
      impulse.close > candles[i - 1].high &&
      impulse.low > candles[baseStart].low * 0.98;

    if (!isSupplyImpulse && !isDemandImpulse) continue;

    // The zone is the base range (before the impulse), padded slightly.
    let baseHigh = candles[baseStart].high;
    let baseLow = candles[baseStart].low;
    for (let k = baseStart + 1; k < i; k++) {
      baseHigh = Math.max(baseHigh, candles[k].high);
      baseLow = Math.min(baseLow, candles[k].low);
    }
    const pad = (baseHigh - baseLow) * 0.15;
    const top = baseHigh + pad;
    const bottom = baseLow - pad;

    // Skip if the base is not meaningfully below (supply) / above (demand)
    // the impulse's opposite edge — a real zone sits off the current price.
    if (isSupplyImpulse && impulse.low > top * 1.01) continue;
    if (isDemandImpulse && impulse.high < bottom * 0.99) continue;

    // Skip zones overlapping an existing zone of the same type.
    const overlaps = zones.some(
      (z) => z.type === (isSupplyImpulse ? "supply" : "demand") && z.top >= bottom && z.bottom <= top,
    );
    if (overlaps) continue;

    // Count touches after the impulse and classify strength.
    let touches = 0;
    let broken = false;
    const current = candles[candles.length - 1];
    for (let j = i + 1; j < candles.length; j++) {
      const c = candles[j];
      if (isSupplyImpulse) {
        if (c.low <= top && c.high >= bottom) touches++;
      } else {
        if (c.high >= bottom && c.low <= top) touches++;
      }
    }
    // Broken: price closed through the zone and never came back.
    if (isSupplyImpulse && current.close > top) broken = true;
    if (isDemandImpulse && current.close < bottom) broken = true;

    const strength: ZoneStrength = broken ? "broken" : touches === 0 ? "fresh" : "tested";
    const active = isSupplyImpulse
      ? current.close <= top && current.close >= bottom * 0.97
      : current.close >= bottom && current.close <= top * 1.03;
    const narrowness = Math.max(0, 1 - (top - bottom) / (avgRange * 3));
    const confidence = Math.round(
      Math.min(96, Math.max(20, 42 + narrowness * 26 + (strength === "fresh" ? 22 : strength === "tested" ? 8 : 0) - touches * 5)),
    );

    zones.push({
      id: `${isSupplyImpulse ? "supply" : "demand"}-${i}`,
      type: isSupplyImpulse ? "supply" : "demand",
      top,
      bottom,
      baseIndex: baseStart,
      baseTime: candles[baseStart].time,
      touches,
      strength,
      active,
      confidence,
      narrowness,
    });
  }

  // Bias from nearest support/demand and resistance/supply around current price.
  const last = candles[candles.length - 1];
  const price = last.close;
  const demandZones = zones.filter((z) => z.type === "demand");
  const supplyZones = zones.filter((z) => z.type === "supply");
  const nearestDemand = demandZones.filter((z) => z.bottom <= price).sort((a, b) => b.bottom - a.bottom)[0];
  const nearestSupply = supplyZones.filter((z) => z.top >= price).sort((a, b) => a.top - b.top)[0];
  const support = nearestDemand?.bottom ?? price * 0.97;
  const resistance = nearestSupply?.top ?? price * 1.03;
  const bias =
    price - support > resistance - price ? "bullish" : price - support < resistance - price ? "bearish" : "neutral";

  // Best actionable setup: nearest fresh/active zone. Skip zones that already
  // ran (TP hit / SL hit / entry never reached) so the plan rolls over to the
  // next best live zone instead of re-serving a finished one.
  const candidates = zones
    .filter((z) => z.strength !== "broken" && z.active)
    .sort((a, b) => b.confidence - a.confidence);

  let setup: SdSetup | null = null;
  for (const zone of candidates) {
    const isLong = zone.type === "demand";
    const direction: SetupDirection = isLong ? "long" : "short";
    const entry = isLong ? zone.top : zone.bottom;
    const stopLoss = findSwingStopLoss(
      candles,
      direction,
      isLong ? zone.bottom : zone.top,
    );
    const { target1, target2 } = buildRiskTargets(entry, stopLoss, direction);

    const status = computeSetupStatus(candles, zone, isLong, entry, stopLoss, target1, target2, price);
    if (isTerminalSetupStatus(status)) continue;

    const rawRr = Math.abs(target2 - entry) / Math.max(1e-9, Math.abs(entry - stopLoss));
    const riskReward = Math.min(9, Math.max(0.3, rawRr));

    setup = {
      direction,
      zone,
      entry,
      target1,
      target2,
      stopLoss,
      riskReward: Number(riskReward.toFixed(2)),
      confidence: zone.confidence,
      status,
      reasoning: [
        `Zona ${zone.type === "demand" ? "demand" : "supply"} yang ${zone.strength === "fresh" ? "baru" : zone.strength === "tested" ? "teruji" : "rusak"} berada di rentang ${formatPrice(zone.bottom)} hingga ${formatPrice(zone.top)} dengan ${zone.touches} sentuhan.`,
        `Harga saat ini ${zone.active ? "berada di dalam" : "mendekati"} zona, sehingga ${isLong ? "beli" : "jual"} dilakukan di ${isLong ? "atas zona" : "bawah zona"} pada harga ${formatPrice(entry)}.`,
        `Stop loss berada di luar swing ${isLong ? "low" : "high"} terakhir pada ${formatPrice(stopLoss)}. Target pertama ${formatPrice(target1)} memakai rasio 1:1 dan target kedua ${formatPrice(target2)} memakai rasio 1:2.`,
      ],
    };
    break;
  }

  return { zones, setup, bias, support, resistance };
}

/** A setup that price has already decided, one way or the other. */
export interface DecidedSetup {
  direction: SetupDirection;
  stopLoss: number;
  target2: number;
  /** Epoch milliseconds; candles that closed before it are not this setup's. */
  runningSince: number;
}

/**
 * Whether price has already decided a setup.
 *
 * Reads the candles that closed since the setup started running, not just the
 * current price. Comparing the spot price alone meant a wick that pierced the
 * stop and recovered before the next read left the setup reporting "Running"
 * forever — the trade was over and the screen still said it was live.
 *
 * A stop takes precedence over a target reached in the same window: intrabar
 * order is unknowable, so the losing outcome is the honest one to assume. That
 * ordering is what keeps a stopped-out setup from being filed as a win in the
 * result archive.
 */
export function setupOutcomeSince(
  candles: Candle[],
  setup: DecidedSetup,
  price: number,
): "stopped" | "target" | null {
  const isLong = setup.direction === "long";
  const since = Math.floor(setup.runningSince / 1_000);

  let stopped = isLong ? price <= setup.stopLoss : price >= setup.stopLoss;
  let target = isLong ? price >= setup.target2 : price <= setup.target2;

  for (const candle of candles) {
    if (candle.time < since) continue;
    if (isLong) {
      if (candle.low <= setup.stopLoss) stopped = true;
      if (candle.high >= setup.target2) target = true;
    } else {
      if (candle.high >= setup.stopLoss) stopped = true;
      if (candle.low <= setup.target2) target = true;
    }
  }

  if (stopped) return "stopped";
  if (target) return "target";
  return null;
}

/**
 * A setup's status, from actual price history.
 *
 * Kept as a thin wrapper so existing callers keep their shape; the walk itself
 * lives in `setup-lifecycle` because the exported performance block and the
 * capture sweep have to read the same one.
 */
export function computeSetupStatus(
  candles: Candle[],
  zone: SdZone,
  isLong: boolean,
  entry: number,
  stopLoss: number,
  target1: number,
  target2: number,
  price: number,
): Status {
  return traceSetupLifecycle(
    candles,
    { direction: isLong ? "long" : "short", entry, stopLoss, target1, target2 },
    zone.baseIndex,
    price,
  ).status;
}

/**
 * A setup the product has already put in front of readers.
 *
 * Carried around by value rather than re-derived, because the whole point is
 * that these numbers stop changing once they are published.
 */
export interface PublishedSetup {
  direction: SetupDirection;
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  confidence: number;
  zoneTop: number;
  zoneBottom: number;
  /** Open time of the bar the zone formed on. */
  zoneBaseTime: number;
}

/**
 * Index of the bar a published zone formed on, or -1 when it is not in the
 * window.
 *
 * It used to answer 0 for "not here". Zero is not an absence, it is a claim:
 * that the zone formed on the leftmost bar loaded. The lifecycle replay then
 * started in the middle of the trade, so the same stored plan came out
 * differently depending on how much history the caller happened to fetch —
 * XPLUSDT read `Limit Order` against three hundred bars and
 * `Invalidated (SL hit)` against a thousand. The board fetches three hundred
 * and the chart fetches three months, which is precisely how the board came to
 * advertise a setup at 80% while the chart refused to draw it and fell back to
 * a different one entirely.
 */
export function publishedBaseIndex(candles: Candle[], zoneBaseTime: number): number {
  return candles.findIndex((candle) => candle.time === zoneBaseTime);
}

/**
 * Bars to fetch so a published setup's own history is in the window.
 *
 * The replay must begin on the bar the zone formed on, so the window has to
 * reach back that far however long the setup has been waiting. Three hundred
 * bars is three days on the fifteen-minute chart, and setups outlive that.
 * A thousand is the most one request returns.
 */
export function publishedScanLimit(
  zoneBaseTime: number,
  timeframe: Timeframe,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number {
  return Math.min(
    MAX_KLINES_PER_REQUEST,
    Math.max(ZONE_SCAN_WINDOW, barsSincePublished(zoneBaseTime, timeframe, nowSeconds)),
  );
}

/**
 * Whether a setup's zone has scrolled past the deepest window one request can
 * return, and so can never be replayed again.
 *
 * Such a plan is held against its symbol forever otherwise: never judged, so
 * never terminal, so never released, and the symbol carries a trade nobody can
 * verify instead of one it could show today.
 */
export function isBeyondScanReach(
  zoneBaseTime: number,
  timeframe: Timeframe,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return barsSincePublished(zoneBaseTime, timeframe, nowSeconds) > MAX_KLINES_PER_REQUEST;
}

/** Bars between a zone's base and now, with a little margin. */
function barsSincePublished(zoneBaseTime: number, timeframe: Timeframe, nowSeconds: number): number {
  const age = Math.max(0, nowSeconds - zoneBaseTime);
  // A few bars of margin so the base bar is never the very first one loaded.
  return Math.ceil(age / TIMEFRAME_SECONDS[timeframe]) + 10;
}

/** Most candles one klines request returns. */
export const MAX_KLINES_PER_REQUEST = 1_000;

/**
 * Re-reads a published setup against the market, without re-choosing it.
 *
 * The single implementation behind both the signals table and the chart. They
 * used to answer this question separately: the table replayed the stored plan
 * while the chart ran the detector again, so a symbol could be listed with a
 * live setup and then open on "No Zone Setup" because every zone the detector
 * could still see had already finished.
 *
 * Returns null once price has finished the setup, which is the signal to the
 * caller that the symbol is free to carry a new one.
 */
export interface PublishedReading {
  /**
   * What price has made of the plan, terminal or not — or null when the bar
   * the zone formed on is not in the window, and there is nothing honest to
   * say about it.
   */
  status: Status | null;
  /** The plan as it should be shown, or null once price has finished it. */
  setup: SdSetup | null;
}

export function readPublishedSetup(
  candles: Candle[],
  published: PublishedSetup,
  price: number,
): PublishedReading {
  const baseIndex = publishedBaseIndex(candles, published.zoneBaseTime);
  // Without the bar the zone formed on, the tape that made this plan is not
  // here to replay, and a guess at where to start is what put a finished setup
  // on the board. Callers fetch `publishedScanLimit` bars so this is rare;
  // when it happens the answer is that there is no answer.
  if (baseIndex < 0) return { status: null, setup: null };

  const life = traceSetupLifecycle(
    candles,
    {
      direction: published.direction,
      entry: published.entry,
      stopLoss: published.stopLoss,
      target1: published.target1,
      target2: published.target2,
    },
    baseIndex,
    price,
  );
  if (isTerminalSetupStatus(life.status)) return { status: life.status, setup: null };

  const isLong = published.direction === "long";
  const zone: SdZone = {
    id: `${isLong ? "demand" : "supply"}-published`,
    type: isLong ? "demand" : "supply",
    top: published.zoneTop,
    bottom: published.zoneBottom,
    baseIndex,
    baseTime: published.zoneBaseTime,
    touches: 1,
    strength: "tested",
    active: true,
    confidence: published.confidence,
    narrowness: 0,
  };
  const risk = Math.abs(published.entry - published.stopLoss);
  const reward = Math.abs(published.target2 - published.entry);
  const setup: SdSetup = {
    direction: published.direction,
    zone,
    entry: published.entry,
    target1: published.target1,
    target2: published.target2,
    stopLoss: published.stopLoss,
    riskReward: Number(Math.min(9, Math.max(0.3, reward / Math.max(1e-9, risk))).toFixed(2)),
    confidence: published.confidence,
    status: life.status,
    reasoning: [
      `Zona ${isLong ? "demand" : "supply"} berada di rentang ${formatPrice(published.zoneBottom)} hingga ${formatPrice(published.zoneTop)}, dan rencana ini sudah terbit sehingga levelnya tidak lagi dihitung ulang.`,
      `Entry ${isLong ? "beli" : "jual"} di ${formatPrice(published.entry)} dengan invalidation di ${formatPrice(published.stopLoss)}.`,
      `Target pertama ${formatPrice(published.target1)} memakai rasio 1:1 dan target kedua ${formatPrice(published.target2)} memakai rasio 1:2.`,
    ],
  };
  return { status: life.status, setup };
}

/** Build a single-lookback quick scan result for the scanner. */
export function scanSd(candles: Candle[]): SdResult {
  return detectSupplyDemand(candles);
}

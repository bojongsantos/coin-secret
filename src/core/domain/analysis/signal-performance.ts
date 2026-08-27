import { traceSetupLifecycle } from "@/core/domain/analysis/setup-lifecycle";
import type { Candle } from "@/core/domain/models";

/**
 * How a setup has actually behaved since it was detected.
 *
 * The exported image is the thing people keep and compare later, so it has to
 * carry more than the plan: it has to say what the plan then did. Everything
 * here is measured from the candles that arrived after detection, never from
 * the setup's own optimism.
 */
export interface SignalPerformance {
  /** Bars that have closed since the signal appeared. */
  barsSince: number;
  priceAtSignal: number;
  priceNow: number;
  /**
   * Move since detection, signed in the setup's favour.
   *
   * A short that fell 3% reports +3, not -3. Reporting raw direction would
   * make every profitable short look like a loss at a glance, which is the
   * one reading this block exists to prevent.
   */
  changePct: number;
  /** Best and worst the trade has been, in the same favour-signed terms. */
  bestPct: number;
  worstPct: number;
  /** Whether price ever traded through the entry after the zone formed. */
  filled: boolean;
  hitTarget1: boolean;
  hitTarget2: boolean;
  hitStop: boolean;
  /** Closes since detection, for a sparkline. First entry is the signal bar. */
  series: number[];
}

export interface SignalPerformanceInput {
  candles: Candle[];
  /**
   * Open time of the bar the signal belongs to, in seconds.
   *
   * A bar time, not a wall clock. The analysis is rebuilt on every request, so
   * its own timestamp is always "now" and would place every signal on the last
   * candle — leaving nothing after it to measure. The zone's base bar is when
   * the setup actually appeared.
   */
  signalTime: number;
  direction: "long" | "short";
  /**
   * The limit price.
   *
   * Targets only count once price has actually traded through it. Without
   * this, a setup whose entry was never touched still reported "Target 1 ✓"
   * because price happened to sweep past that level on its way somewhere
   * else — the export claimed a win on a trade that was never opened, beside
   * a plan that still read "Limit Order".
   */
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
}

/** Percentage move from `from` to `to`, signed in the trade's favour. */
function favourPct(from: number, to: number, direction: "long" | "short"): number {
  if (!Number.isFinite(from) || from === 0) return 0;
  const raw = ((to - from) / from) * 100;
  return direction === "short" ? -raw : raw;
}

/**
 * Measures a setup against the bars that followed it.
 *
 * Returns null when there is nothing to measure — no candles, an unusable bar
 * time, or a signal newer than the last close. A null result is not a
 * failure: a setup detected on the current bar simply has no history yet, and
 * inventing a flat 0% for it would read as "went nowhere" rather than "too
 * early to say".
 */
export function buildSignalPerformance(input: SignalPerformanceInput): SignalPerformance | null {
  const { candles, direction, entry, target1, target2, stopLoss } = input;
  if (candles.length === 0) return null;

  if (!Number.isFinite(input.signalTime)) return null;

  // Candle times are the bar's open. The signal belongs to the last bar that
  // had already opened when it appeared, not the next one to arrive.
  let startIndex = -1;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].time <= input.signalTime) {
      startIndex = i;
      break;
    }
  }
  if (startIndex < 0) return null;

  // The plan's own reading of itself, so this block and the status badge can
  // never describe two different trades.
  const life = traceSetupLifecycle(
    candles,
    { direction, entry, stopLoss, target1, target2 },
    startIndex,
    candles[candles.length - 1].close,
  );
  // Measured from the bar the order became placeable. Before that the setup is
  // still forming and there is nothing yet to have performed.
  if (life.armedIndex === null) return null;
  const window = candles.slice(life.armedIndex);
  if (window.length < 2) return null;

  const priceAtSignal = window[0].close;
  const priceNow = window[window.length - 1].close;

  let best = 0;
  let worst = 0;

  for (let i = 0; i < window.length; i++) {
    const candle = window[i];

    // Excursions skip bar 0: a bar cannot have moved away from its own close,
    // and counting it would report a swing that never happened.
    if (i > 0) {
      const favourHigh = favourPct(priceAtSignal, direction === "long" ? candle.high : candle.low, direction);
      const favourLow = favourPct(priceAtSignal, direction === "long" ? candle.low : candle.high, direction);
      if (favourHigh > best) best = favourHigh;
      if (favourLow < worst) worst = favourLow;
    }

    // Level checks do not skip it. The status machine counts every bar from
    // here on, and a fill that landed on this one had the panel reporting
    // "Target 1 reached" beside a block insisting the order never triggered.
  }

  return {
    barsSince: window.length - 1,
    priceAtSignal,
    priceNow,
    changePct: Number(favourPct(priceAtSignal, priceNow, direction).toFixed(2)),
    bestPct: Number(best.toFixed(2)),
    worstPct: Number(worst.toFixed(2)),
    filled: life.filledIndex !== null,
    hitTarget1: life.target1Index !== null,
    hitTarget2: life.target2Index !== null,
    hitStop: life.stopIndex !== null,
    series: window.map((candle) => candle.close),
  };
}

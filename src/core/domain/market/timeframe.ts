import type { Timeframe } from "@/core/domain/models";

/**
 * Timeframes the app offers and scans, in display order.
 *
 * Held to the two fastest charts. A setup on the four-hour or the daily can
 * sit unresolved for days before anyone learns whether it was right, so the
 * board fills up with plans nobody can act on today; the faster charts produce
 * more setups and settle them inside a session.
 *
 * `TIMEFRAME_SECONDS` still covers the slower ones, so a stored setup or a
 * saved link that names one keeps working.
 */
export const TIMEFRAMES: readonly Timeframe[] = ["15m", "1H"];

/** Seconds covered by one candle of each timeframe. */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "15m": 900,
  "1H": 3_600,
  "4H": 14_400,
  "1D": 86_400,
};

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && TIMEFRAMES.includes(value as Timeframe);
}

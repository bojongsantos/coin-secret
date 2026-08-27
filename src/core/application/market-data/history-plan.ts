import { TIMEFRAME_SECONDS } from "@/core/domain/market/timeframe";
import type { Timeframe } from "@/core/domain/models";

/** Selectable history spans. Every span works with every timeframe. */
export const HISTORY_RANGES = ["1M", "3M", "1Y", "ALL"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export const HISTORY_RANGE_HINT: Record<HistoryRange, string> = {
  "1M": "Satu bulan terakhir",
  "3M": "Tiga bulan terakhir",
  "1Y": "Satu tahun terakhir",
  ALL: "Sejak coin pertama diperdagangkan",
};

const RANGE_DAYS: Record<Exclude<HistoryRange, "ALL">, number> = {
  "1M": 30,
  "3M": 90,
  "1Y": 365,
};

const SECONDS_PER_DAY = 86_400;

/**
 * How much history a timeframe loads.
 *
 * Chosen by the chart rather than by the reader. Detection reads a fixed
 * window of the most recent bars, so a range that supplies fewer than that
 * makes the chart disagree with the table it was opened from — three months
 * of a daily chart is ninety candles against a detector that wants three
 * hundred. Every entry here clears that window with room to scroll.
 */
export function rangeForTimeframe(timeframe: Timeframe): HistoryRange {
  if (timeframe === "1D") return "ALL";
  if (timeframe === "4H") return "1Y";
  return "3M";
}

export function isHistoryRange(value: unknown): value is HistoryRange {
  return typeof value === "string" && HISTORY_RANGES.includes(value as HistoryRange);
}

/**
 * Earliest second a range asks for. A bounded range never reaches past the
 * listing date, so "1Y" on a coin listed two months ago means two months.
 */
export function resolveRangeStart(
  range: HistoryRange,
  listingSeconds: number,
  nowSeconds: number,
): number {
  if (range === "ALL") return listingSeconds;
  return Math.max(listingSeconds, nowSeconds - RANGE_DAYS[range] * SECONDS_PER_DAY);
}

/**
 * Candles a bounded range needs at a given interval, or null when the range is
 * open-ended. Lets the first fetch ask for exactly the selected window instead
 * of a fixed page, so "1M" on a daily chart does not quietly show two years.
 */
export function estimateRangeCandles(range: HistoryRange, timeframe: Timeframe): number | null {
  if (range === "ALL") return null;
  return Math.ceil((RANGE_DAYS[range] * SECONDS_PER_DAY) / TIMEFRAME_SECONDS[timeframe]) + 1;
}

export interface HistoryPlan {
  /**
   * Page start times in milliseconds, ascending. Pages are disjoint and
   * complete, so they can be fetched concurrently and in any order.
   */
  pageStarts: number[];
  /** Earliest second the plan actually reaches. */
  fromSeconds: number;
  /** Candles the plan covers when every page comes back full. */
  estimatedCandles: number;
  /** True when the candle budget clipped the plan short of the request. */
  truncated: boolean;
}

/**
 * Splits a time window into fixed-size pages that can be fetched in parallel.
 *
 * Paging forwards from a known start is what makes lifetime history viable on
 * intraday timeframes: every page start is computable up front, so the pages
 * fetch concurrently instead of walking backwards one dependent request at a
 * time. A candle budget keeps a request like "15m since 2017" from exhausting
 * the browser, and reports itself honestly through `truncated`.
 */
export function planHistoryPages(options: {
  fromSeconds: number;
  toSeconds: number;
  timeframe: Timeframe;
  pageSize: number;
  maxCandles: number;
}): HistoryPlan {
  const step = TIMEFRAME_SECONDS[options.timeframe];
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const maxCandles = Math.max(1, Math.floor(options.maxCandles));
  const to = options.toSeconds;

  if (to <= options.fromSeconds) {
    const aligned = Math.floor(options.fromSeconds / step) * step;
    return {
      pageStarts: [aligned * 1_000],
      fromSeconds: aligned,
      estimatedCandles: 1,
      truncated: false,
    };
  }

  const wanted = Math.floor((to - options.fromSeconds) / step) + 1;
  const truncated = wanted > maxCandles;
  const rawStart = truncated ? to - (maxCandles - 1) * step : options.fromSeconds;
  const from = Math.floor(rawStart / step) * step;

  const total = Math.floor((to - from) / step) + 1;
  const pageCount = Math.ceil(total / pageSize);
  const pageStarts: number[] = [];
  for (let page = 0; page < pageCount; page++) {
    pageStarts.push((from + page * pageSize * step) * 1_000);
  }

  return { pageStarts, fromSeconds: from, estimatedCandles: total, truncated };
}

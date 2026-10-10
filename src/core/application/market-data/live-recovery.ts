import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import type { Candle, Timeframe } from "@/core/domain/models";
import { mergeCandleSeries } from "@/core/domain/market/candles";
import { TIMEFRAME_SECONDS } from "@/core/domain/market/timeframe";
import { HISTORY_PAGE_SIZE, MAX_HISTORY_CANDLES } from "@/core/application/market-data/history-loader";

export function hasCandleGap(candles: readonly Candle[], timeframe: Timeframe): boolean {
  const step = TIMEFRAME_SECONDS[timeframe];
  return candles.some((candle, index) => index > 0 && candle.time - candles[index - 1].time !== step);
}

/** Recover every missed interval, with bounded pages on either exchange. */
export async function recoverRecentCandles(
  marketData: MarketDataPort,
  symbol: string,
  timeframe: Timeframe,
  lastTime: number,
  nowSeconds: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const step = TIMEFRAME_SECONDS[timeframe];
  const until = Math.floor(nowSeconds / step) * step;
  if (until - lastTime > MAX_HISTORY_CANDLES * step) {
    throw new Error("Chart recovery exceeds its candle budget");
  }
  const batches: Candle[][] = [];
  for (let start = lastTime; start <= until;) {
    signal?.throwIfAborted();
    const end = Math.min(until, start + (HISTORY_PAGE_SIZE - 1) * step);
    const page = await marketData.fetchKlines({
      symbol, timeframe, limit: Math.floor((end - start) / step) + 1,
      startTime: start * 1_000, endTime: (end + step) * 1_000 - 1, signal,
    });
    const rows = mergeCandleSeries(page).filter((candle) => candle.time >= start && candle.time <= end);
    if (!rows.length || rows[0].time !== start || rows[rows.length - 1].time !== end || hasCandleGap(rows, timeframe)) {
      throw new Error("Chart recovery returned missing candle intervals");
    }
    batches.push(rows);
    start = end + step;
  }
  return mergeCandleSeries(...batches);
}

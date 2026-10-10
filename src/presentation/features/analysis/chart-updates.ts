import type { Candle } from "@/core/domain/models";

export interface ChartCandleUpdate {
  candle: Candle;
  historical: boolean;
}

/** Null requests a full upload; otherwise update only bars that actually changed. */
export function chartCandleUpdates(previous: readonly Candle[] | null, next: readonly Candle[]): ChartCandleUpdate[] | null {
  if (previous === next) return [];
  if (!previous || next.length < previous.length || next[0]?.time !== previous[0]?.time) return null;
  const updates: ChartCandleUpdate[] = [];
  for (let index = 0; index < previous.length; index++) {
    const before = previous[index];
    const after = next[index];
    // Inserted/replaced timestamps change the series structure, not one bar.
    if (after.time !== before.time) return null;
    if (before !== after && (before.open !== after.open || before.high !== after.high || before.low !== after.low || before.close !== after.close)) {
      updates.push({ candle: after, historical: index < previous.length - 1 });
    }
  }
  for (let index = previous.length; index < next.length; index++) {
    updates.push({ candle: next[index], historical: false });
  }
  return updates;
}

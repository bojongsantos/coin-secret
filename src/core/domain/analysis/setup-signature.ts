import type { SetupDirection, Timeframe } from "@/core/domain/models";

/**
 * Stable identity for a setup.
 *
 * Keyed on the zone the setup is built from, not on the plan's prices. The
 * protective stop is placed beyond the latest confirmed swing, so it moves as
 * new bars arrive — the same zone, replanned. Hashing the levels therefore
 * minted a fresh identity on almost every sweep: one symbol accumulated eleven
 * rows for what was one setup, each of them brand new and so with no previous
 * status to compare against. The archive could never see a change because it
 * was never looking at the same thing twice.
 *
 * The base bar cannot move. A zone forms on the candles it forms on, and a
 * later scan that still sees it reports the same `baseTime`.
 *
 * Lived alongside the setup journal until that was removed; the capture
 * archive still needs it to recognise a setup it has already photographed.
 */
export function setupSignature(input: {
  symbol: string;
  timeframe: Timeframe;
  direction: SetupDirection;
  /** Open time of the bar the zone formed on, in seconds. */
  zoneBaseTime: number;
}): string {
  return [
    input.symbol.toUpperCase(),
    input.timeframe,
    input.direction,
    String(Math.trunc(input.zoneBaseTime)),
  ].join("|");
}

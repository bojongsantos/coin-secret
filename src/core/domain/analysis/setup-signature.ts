import type { SetupDirection, Timeframe } from "@/core/domain/models";

/**
 * Stable identity for a setup.
 *
 * Prices are rounded before hashing because a live feed jitters in the last
 * decimals without the plan itself having changed, and the same zone seen on
 * a later scan has to hash to the same string or the archive would treat it
 * as a new setup every minute.
 *
 * Lived alongside the setup journal until that was removed; the capture
 * archive still needs it to recognise a setup it has already photographed.
 */
export function setupSignature(input: {
  symbol: string;
  timeframe: Timeframe;
  direction: SetupDirection;
  entry: number;
  stopLoss: number;
}): string {
  const round = (value: number) => value.toPrecision(8);
  return [
    input.symbol.toUpperCase(),
    input.timeframe,
    input.direction,
    round(input.entry),
    round(input.stopLoss),
  ].join("|");
}

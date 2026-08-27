import type { Candle, SetupDirection } from "@/core/domain/models";

/**
 * The one walk through a setup's life.
 *
 * Everything that reports on a setup reads this: the status badge, the
 * exported performance block, the capture sweep. They used to each walk the
 * candles themselves with slightly different rules, and the screen ended up
 * showing a plan that said "Limit Order" beside a block that claimed the first
 * target had already paid.
 */

export type SetupStatus =
  | "Limit Order"
  | "Filled"
  | "Running"
  | "Target 1 reached"
  | "Target 2 reached"
  | "Invalidated (SL hit)"
  | "Missed";

/** Statuses that are still actionable and belong in the scanner table. */
export const ACTIVE_SETUP_STATUSES: SetupStatus[] = [
  "Limit Order",
  "Filled",
  "Running",
  "Target 1 reached",
];

/** Statuses that mean the setup is over and may be replaced by a new one. */
export const TERMINAL_SETUP_STATUSES: SetupStatus[] = [
  "Target 2 reached",
  "Invalidated (SL hit)",
  "Missed",
];

export function isTerminalSetupStatus(status: string): boolean {
  return (TERMINAL_SETUP_STATUSES as string[]).includes(status);
}

export interface SetupPlan {
  direction: SetupDirection;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
}

export interface SetupLifecycle {
  /**
   * Bar where price first closed clear of the entry, in the direction the
   * impulse travelled. Null while the setup is still forming.
   */
  armedIndex: number | null;
  filledIndex: number | null;
  target1Index: number | null;
  target2Index: number | null;
  stopIndex: number | null;
  /** Price ran to the first target without the limit ever being touched. */
  missed: boolean;
  status: SetupStatus;
}

/**
 * Walks a setup from the bar its zone formed to the last candle available.
 *
 * Three phases, in order, because a limit order cannot be filled before it
 * could have been placed:
 *
 *  1. **Forming.** The impulse that creates a zone runs straight through the
 *     entry — that is what makes it an impulse. A supply zone's entry sits at
 *     the zone's *lower* edge, so price sitting inside the freshly formed zone
 *     is already past it and `high >= entry` is true on the very first bar.
 *     Counting that as a fill marked every setup filled the instant it was
 *     detected, and any later dip then read as "Target 1 reached" on a trade
 *     nobody could have been in. Nothing counts until price has closed clear
 *     of the entry and the order has somewhere to wait.
 *
 *  2. **Armed.** The limit is live. It fills when price trades back to it. If
 *     price instead runs to the first target without ever returning, the move
 *     happened without us and the setup is Missed.
 *
 *  3. **Filled.** Targets and the stop are live.
 *
 * Within the fill bar only the stop may register. Intrabar order is
 * unknowable, so the rule throughout is the same one the result archive uses:
 * never claim a win that cannot be proved, never rule out a loss that cannot
 * be excluded.
 */
export function traceSetupLifecycle(
  candles: Candle[],
  plan: SetupPlan,
  fromIndex: number,
  price: number,
): SetupLifecycle {
  const long = plan.direction === "long";
  let armedIndex: number | null = null;
  let filledIndex: number | null = null;
  let target1Index: number | null = null;
  let target2Index: number | null = null;
  let stopIndex: number | null = null;
  let missed = false;

  const stoppedOn = (c: Candle) => (long ? c.low <= plan.stopLoss : c.high >= plan.stopLoss);
  const reached = (c: Candle, level: number) => (long ? c.high >= level : c.low <= level);

  for (let i = Math.max(0, fromIndex); i < candles.length; i++) {
    const candle = candles[i];

    if (armedIndex === null) {
      // A close, not a wick: a single spike through the entry is not the
      // impulse leaving, and treating it as one re-opens the same hole.
      const departed = long ? candle.close > plan.entry : candle.close < plan.entry;
      if (departed) armedIndex = i;
      continue;
    }

    if (filledIndex === null) {
      const touched = long ? candle.low <= plan.entry : candle.high >= plan.entry;
      if (touched) {
        filledIndex = i;
        if (stoppedOn(candle)) {
          stopIndex = i;
          break;
        }
        continue;
      }
      if (reached(candle, plan.target1)) missed = true;
      continue;
    }

    if (target1Index === null && reached(candle, plan.target1)) target1Index = i;

    // A bar that touches both the stop and the second target is resolved
    // against the trade, for the same reason as the fill bar.
    if (stoppedOn(candle)) {
      stopIndex = i;
      break;
    }
    if (reached(candle, plan.target2)) {
      target2Index = i;
      break;
    }
  }

  return {
    armedIndex,
    filledIndex,
    target1Index,
    target2Index,
    stopIndex,
    missed,
    status: statusFor(
      { armedIndex, filledIndex, target1Index, target2Index, stopIndex, missed },
      plan,
      price,
    ),
  };
}

function statusFor(
  marks: Omit<SetupLifecycle, "status">,
  plan: SetupPlan,
  price: number,
): SetupStatus {
  // Still forming: the impulse has not finished leaving, so there is no order
  // to speak of yet. Reported as a live limit rather than as nothing, because
  // that is what the reader is being shown on the chart.
  if (marks.armedIndex === null) return "Limit Order";
  if (marks.filledIndex === null) return marks.missed ? "Missed" : "Limit Order";
  if (marks.stopIndex !== null) return "Invalidated (SL hit)";
  if (marks.target2Index !== null) return "Target 2 reached";
  if (marks.target1Index !== null) return "Target 1 reached";
  // Filled, and waiting for price to confirm the direction past the entry.
  const moved = plan.direction === "long" ? price > plan.entry : price < plan.entry;
  return moved ? "Running" : "Filled";
}

import { TERMINAL_SETUP_STATUSES, type SetupStatus } from "@/core/domain/analysis/supply-demand";

/**
 * The two moments worth photographing in a setup's life.
 *
 * ENTRY is the plan as it stood when price actually reached it; RESULT is what
 * became of that plan. A pair of them is the proof — either alone is just a
 * screenshot.
 */
export type CaptureKind = "ENTRY" | "RESULT";

/**
 * Statuses that mean price has traded through the entry.
 *
 * The archive needs to know a position was opened, not which rung of the plan
 * it is currently on.
 */
const FILLED_STATUSES: SetupStatus[] = ["Filled", "Running", "Target 1 reached"];

/** Whether a status means the order is live in the market. */
export function isFilledStatus(status: SetupStatus): boolean {
  return FILLED_STATUSES.includes(status);
}

/**
 * Which capture, if any, a status change calls for.
 *
 * Takes the previous status as well as the new one because a sweep sees the
 * same setup again and again. Firing on the status alone would re-photograph a
 * filled setup on every run and fill the archive with duplicates of the same
 * moment.
 *
 * ENTRY fires on the move out of "Limit Order" into any filled state, not on
 * "Filled" alone. The sweep runs roughly hourly against a fifteen-minute
 * chart, so a setup is usually already Running by the time it is looked at
 * again; insisting on the exact intermediate status meant the archive recorded
 * one entry in a whole day of live sweeps and nothing at all on most of them.
 *
 * A null previous status is deliberately *not* a trigger: a setup discovered
 * already filled has no before-picture, and a result image built from it would
 * show an entry the scanner never actually called in advance.
 */
export function captureTriggerFor(
  previous: SetupStatus | null,
  next: SetupStatus,
): CaptureKind | null {
  if (previous === null) return null;
  if (previous === next) return null;
  if (previous === "Limit Order" && isFilledStatus(next)) return "ENTRY";
  if (next === "Target 2 reached") return "RESULT";
  return null;
}

/** Whether a status means the setup is over, win or lose. */
export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_SETUP_STATUSES as string[]).includes(status);
}

/**
 * Whether a result image can be composed yet.
 *
 * Both halves must exist. A result without its entry would be a picture of a
 * win with no evidence the setup was called beforehand, which is the opposite
 * of what this archive is for.
 */
export function canComposeResult(hasEntry: boolean, hasResult: boolean): boolean {
  return hasEntry && hasResult;
}

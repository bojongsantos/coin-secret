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
 * it is currently on. "Target 2 reached" belongs here because a sweep that
 * arrives late can meet a setup that has already run its whole course, and
 * that setup still deserves its entry picture.
 */
export const FILLED_STATUSES: SetupStatus[] = [
  "Filled",
  "Running",
  "Target 1 reached",
  "Target 2 reached",
];

/** Whether a status means the order is live in the market. */
export function isFilledStatus(status: SetupStatus): boolean {
  return FILLED_STATUSES.includes(status);
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

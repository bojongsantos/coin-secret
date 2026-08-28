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

/**
 * Whether a setup still owes the archive its entry photograph.
 *
 * A state, not an event. The trigger used to compare the status seen now
 * against the status stored last time, which only works if the sweep is the
 * only thing writing that column and is looking often enough to land inside
 * the transition. Neither held: the live scan writes status on its own now, so
 * the sweep read back a value already updated and saw nothing change, and the
 * scheduled runs drifted to roughly ten hours apart. The archive recorded
 * nothing for a day and reported itself healthy throughout.
 *
 * Asking whether a photograph is owed instead of whether a moment just passed
 * costs nothing and cannot be missed by arriving late.
 */
export function owesEntrySnapshot(input: {
  /** Status the setup carried when it was first published. */
  firstStatus: string;
  /** Status it carries now. */
  status: string;
  hasEntrySnapshot: boolean;
}): boolean {
  if (input.hasEntrySnapshot) return false;
  // Only a setup we published while it was still waiting has a before-picture
  // to pair a result with. Anything already filled when we met it would imply
  // the scanner called an entry it never actually called.
  if (input.firstStatus !== "Limit Order") return false;
  return isFilledStatus(input.status as SetupStatus);
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

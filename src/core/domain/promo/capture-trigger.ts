import type { SetupStatus } from "@/core/domain/analysis/supply-demand";

/**
 * The two moments worth photographing in a setup's life.
 *
 * ENTRY is the plan as it stood when price actually reached it; RESULT is what
 * became of that plan. A pair of them is the proof — either alone is just a
 * screenshot.
 */
export type CaptureKind = "ENTRY" | "RESULT";

/**
 * Which capture, if any, a status change calls for.
 *
 * Takes the previous status as well as the new one because a sweep sees the
 * same setup again and again. Firing on the status alone would re-photograph a
 * filled setup on every run and fill the archive with duplicates of the same
 * moment.
 *
 * A null previous status means the setup was first seen in this state. That is
 * deliberately *not* a trigger: a setup discovered already filled has no
 * before-picture, and a result image built from it would show an entry the
 * scanner never actually called in advance.
 */
export function captureTriggerFor(
  previous: SetupStatus | null,
  next: SetupStatus,
): CaptureKind | null {
  if (previous === null) return null;
  if (previous === next) return null;
  if (previous === "Limit Order" && next === "Filled") return "ENTRY";
  if (next === "Target 2 reached") return "RESULT";
  return null;
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

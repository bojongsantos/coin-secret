/**
 * Geometry for the half-circle gauge.
 *
 * Kept apart from the component so the arc maths can be exercised directly.
 * The bug that prompted it was invisible to every type and lint check: the
 * arc simply rendered the wrong way round.
 */

export const GAUGE_CX = 100;
export const GAUGE_CY = 104;
export const GAUGE_R = 82;

/** The gauge spans half a turn, so a full 0-100 sweep is 180 degrees. */
export const GAUGE_SWEEP_DEGREES = 180;

export interface Point {
  x: number;
  y: number;
}

/** Where a score sits on a circle of the given radius. */
export function pointAt(score: number, radius: number): Point {
  const angle = Math.PI - (score / 100) * Math.PI;
  return { x: GAUGE_CX + radius * Math.cos(angle), y: GAUGE_CY - radius * Math.sin(angle) };
}

/**
 * SVG's large-arc flag for a span of scores.
 *
 * Always 0. A hundred points of score cover 180 degrees, so no span between
 * two valid scores can exceed a half turn, and the minor arc is always the one
 * meant. The previous rule set the flag whenever the span passed 50 points —
 * reading score points as if they were degrees — which made every gauge above
 * 50 draw the *major* arc instead, sweeping the long way round the bottom of
 * the circle and out of the frame.
 */
export function largeArcFlag(fromScore: number, toScore: number): 0 | 1 {
  const degrees = Math.abs(toScore - fromScore) * (GAUGE_SWEEP_DEGREES / 100);
  return degrees > 180 ? 1 : 0;
}

/** The `d` attribute for the arc between two scores. */
export function arcPath(fromScore: number, toScore: number, radius: number): string {
  const start = pointAt(fromScore, radius);
  const end = pointAt(toScore, radius);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag(
    fromScore,
    toScore,
  )} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

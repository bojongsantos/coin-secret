import test from "node:test";
import assert from "node:assert/strict";
import {
  arcPath,
  GAUGE_CX,
  GAUGE_CY,
  GAUGE_R,
  largeArcFlag,
  pointAt,
} from "@/shared/lib/gauge-geometry";

test("the ends of the sweep sit on the horizontal diameter", () => {
  const left = pointAt(0, GAUGE_R);
  const right = pointAt(100, GAUGE_R);
  assert.equal(Math.round(left.x), GAUGE_CX - GAUGE_R);
  assert.equal(Math.round(left.y), GAUGE_CY);
  assert.equal(Math.round(right.x), GAUGE_CX + GAUGE_R);
  assert.equal(Math.round(right.y), GAUGE_CY);
  // Half the scale is the top of the arc.
  const top = pointAt(50, GAUGE_R);
  assert.equal(Math.round(top.x), GAUGE_CX);
  assert.equal(Math.round(top.y), GAUGE_CY - GAUGE_R);
});

test("no span between two scores is ever a major arc", () => {
  // 100 points of score cover 180 degrees, so nothing can exceed a half turn.
  // Treating 50 points as the cutoff read score as degrees and made every
  // gauge above 50 sweep the long way round, out of the frame.
  assert.equal(largeArcFlag(0, 51), 0);
  assert.equal(largeArcFlag(0, 72), 0);
  assert.equal(largeArcFlag(0, 100), 0);
  assert.equal(largeArcFlag(0, 0), 0);
  assert.equal(largeArcFlag(100, 0), 0);
});

test("a high score still draws the minor arc", () => {
  const d = arcPath(0, 72, GAUGE_R);
  // flags are "<large-arc> <sweep>"; the first must stay 0.
  assert.match(d, /A 82 82 0 0 1 /);
  assert.doesNotMatch(d, /A 82 82 0 1 1 /);
});

test("every score keeps the arc inside the drawing box", () => {
  // The frame is 200x116 with an 11-wide stroke, so 5.5 either side.
  for (let score = 0; score <= 100; score++) {
    const point = pointAt(score, GAUGE_R + 7);
    assert.ok(point.x >= -1 && point.x <= 201, `x out of frame at ${score}: ${point.x}`);
    assert.ok(point.y >= -1 && point.y <= 117, `y out of frame at ${score}: ${point.y}`);
  }
});

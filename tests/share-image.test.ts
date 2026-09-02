import test from "node:test";
import assert from "node:assert/strict";
import {
  chartPlacement,
  EXPORT_CHART_HEIGHT,
  EXPORT_CHART_WIDTH,
} from "@/presentation/features/analysis/share-image";

test("a capture taken at the frame size fills it exactly", () => {
  // The chart is now rendered at these dimensions before it is photographed,
  // so this is the normal path: no scaling, no offset, no waste.
  const fitted = chartPlacement(EXPORT_CHART_WIDTH, EXPORT_CHART_HEIGHT);
  assert.equal(fitted.width, EXPORT_CHART_WIDTH);
  assert.equal(fitted.height, EXPORT_CHART_HEIGHT);
  assert.equal(fitted.offsetX, 0);
  assert.equal(fitted.offsetY, 0);
});

test("no part of the chart is ever cropped out of a picture of the chart", () => {
  // Whatever shape a capture arrives in, all of it has to be inside the frame.
  // Filling instead of containing would push the edges out of view, and a
  // downloaded chart that silently loses its right-hand bars is worse than an
  // ugly one.
  const shapes: Array<[number, number]> = [
    [440, 420], // what the old capture actually produced
    [1920, 400], // a very wide window
    [300, 900], // a very tall one
    [720, 470], // the frame itself
    [1, 1],
    [0, 0], // degenerate input must not divide by zero
  ];
  for (const [w, h] of shapes) {
    const placed = chartPlacement(w, h);
    assert.ok(placed.width <= EXPORT_CHART_WIDTH + 0.001, `${w}x${h} overflows the frame width`);
    assert.ok(placed.height <= EXPORT_CHART_HEIGHT + 0.001, `${w}x${h} overflows the frame height`);
    // A hair of floating-point slack: 900 * (470 / 900) lands a whisker over
    // 470, which is arithmetic noise rather than a chart hanging off the edge.
    assert.ok(placed.offsetX >= -0.001, `${w}x${h} starts outside the frame`);
    assert.ok(placed.offsetY >= -0.001, `${w}x${h} starts above the frame`);
    assert.ok(Number.isFinite(placed.width) && placed.width > 0, `${w}x${h} produced no chart`);
    assert.ok(Number.isFinite(placed.height) && placed.height > 0);
  }
});

test("the chart is never stretched out of shape", () => {
  for (const [w, h] of [[440, 420], [1920, 400], [300, 900]] as Array<[number, number]>) {
    const placed = chartPlacement(w, h);
    assert.ok(
      Math.abs(placed.width / placed.height - w / h) < 0.001,
      `${w}x${h} was distorted to ${placed.width}x${placed.height}`,
    );
  }
});

test("the capture the chart panel takes needs no scaling at all", () => {
  // The guarantee that removed both the empty bands and the softness: the
  // chart is rendered at these exact dimensions before being photographed, so
  // the export draws it one pixel for one pixel.
  const placed = chartPlacement(EXPORT_CHART_WIDTH, EXPORT_CHART_HEIGHT);
  assert.equal(placed.width / EXPORT_CHART_WIDTH, 1, "no horizontal scaling");
  assert.equal(placed.height / EXPORT_CHART_HEIGHT, 1, "no vertical scaling");
});

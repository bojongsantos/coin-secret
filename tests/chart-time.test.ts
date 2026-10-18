import test from "node:test";
import assert from "node:assert/strict";
import { chartTimeFormatters } from "@/presentation/features/analysis/chart-time";

const epoch = Date.parse("2026-10-18T11:00:00Z") / 1_000;

test("chart axis and crosshair show the same UTC epoch in the reader's timezone", () => {
  const jakarta = chartTimeFormatters("en-US", "Asia/Jakarta");
  const utc = chartTimeFormatters("en-US", "UTC");
  assert.match(jakarta.timeFormatter(epoch), /Oct 18, 26, 18:00 GMT\+7/);
  assert.equal(jakarta.tickMarkFormatter(epoch, 3), "18:00");
  assert.match(utc.timeFormatter(epoch), /Oct 18, 26, 11:00 GMT/);
  assert.equal(utc.tickMarkFormatter(epoch, 3), "11:00");
});

test("chart formatting follows local date rollover and daylight saving", () => {
  const jakarta = chartTimeFormatters("en-US", "Asia/Jakarta");
  const midnight = Date.parse("2026-10-18T17:00:00Z") / 1_000;
  assert.match(jakarta.timeFormatter(midnight), /Oct 19, 26, 00:00 GMT\+7/);
  assert.equal(jakarta.tickMarkFormatter(midnight, 2), "19");
  const newYork = chartTimeFormatters("en-US", "America/New_York");
  assert.match(newYork.timeFormatter(Date.parse("2026-01-18T11:00:00Z") / 1_000), /06:00 GMT-5/);
  assert.match(newYork.timeFormatter(epoch), /07:00 GMT-4/);
  assert.equal(jakarta.timeFormatter("2026-10-18"), "2026-10-18");
  assert.equal(jakarta.tickMarkFormatter({ year: 2026, month: 10, day: 18 }, 2), null);
});

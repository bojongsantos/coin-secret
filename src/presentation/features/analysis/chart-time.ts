import type { TickMarkType, Time } from "lightweight-charts";

/** Format the exchange's UTC epochs; never shift the candles themselves. */
export function chartTimeFormatters(locale: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, {
    timeZone, hourCycle: "h23", ...options,
  });
  const timestamp = format({ year: "2-digit", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" });
  // TickMarkType is ordered Year, Month, DayOfMonth, Time, TimeWithSeconds.
  const ticks = [
    format({ year: "numeric" }),
    format({ month: "short" }),
    format({ day: "2-digit" }),
    format({ hour: "2-digit", minute: "2-digit" }),
    format({ hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  ];

  return {
    // Exchange candles use epoch seconds; calendar days remain calendar days.
    timeFormatter: (time: Time | number) => typeof time === "number"
      ? timestamp.format(new Date(time * 1_000))
      : typeof time === "string" ? time : `${time.year}-${time.month}-${time.day}`,
    tickMarkFormatter: (time: Time | number, type: TickMarkType) => typeof time === "number"
      ? ticks[type].format(new Date(time * 1_000))
      : null,
  };
}

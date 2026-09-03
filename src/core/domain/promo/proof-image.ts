import type { Candle } from "@/core/domain/models";
import { formatPrice, priceDecimals } from "@/shared/lib/format";

/**
 * The published proof: one setup, told as before and after.
 *
 * Both panels draw the *same* candles on the *same* two scales. The previous
 * version composed two independently scaled charts, so the zone sat at a
 * different height and the bars at a different width in each half, and reading
 * it meant re-orienting twice. Sharing the scales is what turns two pictures
 * into one story.
 *
 * Drawn as SVG because the capture runs on a schedule with no browser near it,
 * and because every coordinate is then a number a test can check.
 */

const COLOR = {
  background: "#07070c",
  surface: "#0e0e16",
  surface2: "#13131d",
  surface3: "#1a1a28",
  border: "#1e1e2c",
  foreground: "#f2f2f7",
  muted: "#9a9aab",
  muted2: "#66667a",
  accent: "#7c5cff",
  accentBlue: "#4f7cff",
  up: "#089981",
  down: "#f23645",
  positive: "#22c55e",
  negative: "#f43f5e",
} as const;

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Square: the one shape both X and Instagram show without cropping. */
export const PROOF_SIZE = 1200;

const PAD = 44;
/** Right-hand gutter holding the price pills, outside the plot. */
const AXIS_W = 104;

export const LAYOUT = {
  headerBottom: 112,
  panelHeight: 372,
  panelGap: 22,
  entryTop: 132,
  get resultTop() {
    return this.entryTop + this.panelHeight + this.panelGap;
  },
  get metricsTop() {
    return this.resultTop + this.panelHeight + 28;
  },
  metricsHeight: 116,
  /** Chart area inside a panel, measured from the panel's own top. */
  chartTop: 56,
  chartBottom: 14,
} as const;

const PLOT_X = PAD + 14;
const PLOT_W = PROOF_SIZE - PAD * 2 - 28 - AXIS_W;

/** Escapes the five characters that would otherwise break the markup. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface TextOptions {
  size?: number;
  weight?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
}

function text(value: string, x: number, y: number, options: TextOptions = {}): string {
  const { size = 12, weight = 500, fill = COLOR.foreground, anchor = "start", opacity } = options;
  const alpha = opacity === undefined ? "" : ` opacity="${opacity}"`;
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${alpha}>${escapeXml(value)}</text>`;
}

function rect(x: number, y: number, w: number, h: number, fill: string, extra = ""): string {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${fill}" ${extra}/>`;
}

export interface ProofInput {
  symbol: string;
  timeframe: string;
  direction: "long" | "short";
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  confidence: number;
  riskReward: number;
  zoneTop: number;
  zoneBottom: number;
  /** One window, shared by both panels. Ascending, no gaps. */
  candles: Candle[];
  /** Open time of the bar the entry filled on, in seconds. */
  entryFilledTime: number;
  entryFilledPrice: number;
  /** Open time of the bar the second target was reached on, in seconds. */
  targetReachedTime: number;
  targetReachedPrice: number;
}

/**
 * The stretch of market worth showing.
 *
 * Anchored on the trade rather than on the zone: enough lead-in to see the
 * approach, then the trade itself, then a little after the target. A fixed
 * window let one setup arrive with three hundred bars of prologue and ninety
 * of trade, which buries the thing the picture is about and squeezes the bars
 * until they smear.
 */
export function proofWindow(
  total: number,
  filledIndex: number,
  targetIndex: number,
): { from: number; to: number } {
  const tradeBars = Math.max(1, targetIndex - filledIndex);
  const leadIn = Math.min(120, Math.max(30, Math.round(tradeBars * 0.8)));
  const tail = Math.max(6, Math.round(tradeBars * 0.1));
  return {
    from: Math.max(0, filledIndex - leadIn),
    to: Math.min(total, targetIndex + tail + 1),
  };
}

/**
 * Most bars the plot can hold before they stop being readable.
 *
 * Below roughly four pixels a body is thinner than the gap beside it and the
 * chart turns into a smear, which is the failure this picture exists to avoid.
 */
const MAX_BARS = 200;

/**
 * Merges runs of candles into single bars.
 *
 * A trade that ran four days on the fifteen-minute chart is five hundred bars.
 * Grouping them is not a simplification of the data but a change of interval:
 * the open of the first, the close of the last, the highest high and the
 * lowest low is exactly the bar an hourly chart would have drawn.
 */
export function bucketCandles(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const group = candles.slice(i, i + factor);
    out.push({
      time: group[0].time,
      open: group[0].open,
      close: group[group.length - 1].close,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

/** How many bars to merge so the plot stays legible. */
export function bucketFactor(count: number): number {
  return Math.max(1, Math.ceil(count / MAX_BARS));
}

/** Vertical scale, spanning the candles and every plan level. */
function priceScale(input: ProofInput, top: number, height: number) {
  const values = [
    ...input.candles.map((c) => c.high),
    ...input.candles.map((c) => c.low),
    input.entry,
    input.target1,
    input.target2,
    input.stopLoss,
    input.zoneTop,
    input.zoneBottom,
  ].filter((v) => Number.isFinite(v));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.01 || 1;
  const low = min - pad;
  const span = max + pad - low || 1;
  return (price: number) => top + height - ((price - low) / span) * height;
}

/** Horizontal scale. Identical in both panels, which is the whole point. */
function timeScale(candles: Candle[]) {
  const slot = PLOT_W / Math.max(1, candles.length);
  return {
    slot,
    /** Centre of the bar at an index. */
    at: (index: number) => PLOT_X + slot * (index + 0.5),
    /** Nearest bar index for a bar open time. */
    indexOf: (seconds: number) => {
      let best = 0;
      for (let i = 0; i < candles.length; i++) {
        if (candles[i].time <= seconds) best = i;
        else break;
      }
      return best;
    },
  };
}

function candlesticks(
  candles: Candle[],
  y: (price: number) => number,
  time: ReturnType<typeof timeScale>,
  dim = false,
): string {
  // A bar has to be wider than the gap beside it, or the chart reads as a row
  // of sticks with holes between them. The old ceiling of ten pixels did
  // exactly that on a short window: fifty bars give each one twenty pixels of
  // room, and drawing ten of them left more background than candle. The body
  // now keeps its share of the slot whatever the bar count, and the outer
  // limit is only there for a window too short to happen in practice.
  const body = Math.max(2.5, Math.min(time.slot * 0.7, 22));
  // The wick grows with it. Held at a hairline it looked like a thread
  // stitched through a block once the bodies were wide.
  const wick = Math.max(1.2, body * 0.14);
  const alpha = dim ? ' opacity="0.35"' : "";
  return candles
    .map((candle, index) => {
      const cx = time.at(index);
      const color = candle.close >= candle.open ? COLOR.up : COLOR.down;
      const top = Math.min(y(candle.open), y(candle.close));
      // A bar that opened and closed at one price still happened. Given a
      // floor it reads as a doji; without one it is a hole in the chart.
      const height = Math.max(1.5, Math.abs(y(candle.close) - y(candle.open)));
      return (
        `<line x1="${cx.toFixed(1)}" y1="${y(candle.high).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(candle.low).toFixed(1)}" stroke="${color}" stroke-width="${wick.toFixed(1)}"${alpha}/>` +
        rect(cx - body / 2, top, body, height, color, alpha.trim())
      );
    })
    .join("");
}

function levelLine(
  label: string,
  price: number,
  color: string,
  y: (price: number) => number,
  decimals: number,
  top: number,
  height: number,
): string {
  const at = y(price);
  if (!Number.isFinite(at) || at < top - 2 || at > top + height + 2) return "";
  const pillX = PLOT_X + PLOT_W + 6;
  const pillW = AXIS_W - 12;
  return (
    `<line x1="${PLOT_X}" y1="${at.toFixed(1)}" x2="${(PLOT_X + PLOT_W).toFixed(1)}" y2="${at.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="5 5" opacity="0.85"/>` +
    rect(pillX, at - 9, pillW, 18, color, 'rx="4"') +
    text(`${label} ${formatPrice(price, decimals)}`, pillX + pillW / 2, at + 5, {
      size: 10,
      weight: 700,
      fill: "#06060a",
      anchor: "middle",
    })
  );
}

/** The frame, level lines and zone band shared by both panels. */
function panelChrome(
  input: ProofInput,
  y: (price: number) => number,
  top: number,
  height: number,
): string {
  const zoneTop = y(Math.max(input.zoneTop, input.zoneBottom));
  const zoneBottom = y(Math.min(input.zoneTop, input.zoneBottom));
  return (
    rect(PLOT_X - 14, top, PROOF_SIZE - PAD * 2, height, COLOR.background, `rx="8" stroke="${COLOR.border}"`) +
    rect(
      PLOT_X,
      zoneTop,
      PLOT_W,
      zoneBottom - zoneTop,
      input.direction === "long" ? COLOR.positive : COLOR.negative,
      'opacity="0.10"',
    )
  );
}

function levels(
  input: ProofInput,
  y: (price: number) => number,
  top: number,
  height: number,
  decimals: number,
): string {
  return (
    levelLine("SL", input.stopLoss, COLOR.negative, y, decimals, top, height) +
    levelLine("Entry", input.entry, COLOR.accentBlue, y, decimals, top, height) +
    levelLine("T1", input.target1, COLOR.positive, y, decimals, top, height) +
    levelLine("T2", input.target2, COLOR.positive, y, decimals, top, height)
  );
}

/** `2026-08-27 01:30` from a bar's open time. */
function stamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/** `40 hours` — whole hours, which is the resolution anyone reads this at. */
export function formatDuration(fromSeconds: number, toSeconds: number): string {
  const hours = Math.max(0, Math.round((toSeconds - fromSeconds) / 3600));
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Move from entry to the second target, signed in the trade's favour. */
export function resultPercent(input: ProofInput): number {
  const raw = ((input.targetReachedPrice - input.entryFilledPrice) / input.entryFilledPrice) * 100;
  return Number((input.direction === "short" ? -raw : raw).toFixed(1));
}

function panelHeader(
  badge: string,
  badgeColor: string,
  when: string,
  right: string,
  rightColor: string,
  top: number,
): string {
  const badgeW = 62 + badge.length * 3;
  return (
    rect(PLOT_X - 14, top + 14, badgeW, 22, badgeColor, 'rx="5" opacity="0.18"') +
    text(badge, PLOT_X - 14 + badgeW / 2, top + 29, {
      size: 10,
      weight: 700,
      fill: badgeColor,
      anchor: "middle",
    }) +
    text(when, PLOT_X - 14 + badgeW + 14, top + 29, { size: 12, fill: COLOR.muted }) +
    text(right, PROOF_SIZE - PAD - 4, top + 29, {
      size: 13,
      weight: 700,
      fill: rightColor,
      anchor: "end",
    })
  );
}

/**
 * The whole proof.
 *
 * @param logoHref Wordmark as a data URI, so the file stands alone once saved.
 */
export function composeProofImage(raw: ProofInput & { logoHref?: string }): string {
  const factor = bucketFactor(raw.candles.length);
  const input = factor > 1 ? { ...raw, candles: bucketCandles(raw.candles, factor) } : raw;
  const decimals = priceDecimals(input.entry);
  const time = timeScale(input.candles);
  const entryIndex = time.indexOf(input.entryFilledTime);
  const targetIndex = time.indexOf(input.targetReachedTime);
  const entryX = time.at(entryIndex);
  const targetX = time.at(targetIndex);

  const chartTop = (panelTop: number) => panelTop + LAYOUT.chartTop;
  const chartHeight = LAYOUT.panelHeight - LAYOUT.chartTop - LAYOUT.chartBottom;

  const entryY = priceScale(input, chartTop(LAYOUT.entryTop), chartHeight);
  const resultY = priceScale(input, chartTop(LAYOUT.resultTop), chartHeight);

  const bullish = input.direction === "long";
  const move = resultPercent(input);

  // ---------------------------------------------------------------- header
  const logo = input.logoHref
    ? `<image href="${escapeXml(input.logoHref)}" x="${PAD}" y="${PAD - 6}" width="${Math.round((32 * 844) / 105)}" height="32"/>`
    : text("Coin Secret", PAD, PAD + 20, { size: 22, weight: 700 });

  const header =
    logo +
    text(`${input.symbol.toUpperCase()} · Target 2 Reached`, PROOF_SIZE / 2, PAD + 16, {
      size: 24,
      weight: 700,
      anchor: "middle",
    }) +
    text(
      `${input.timeframe}${factor > 1 ? ` ×${factor}` : ""} · ${bullish ? "Demand Zone" : "Supply Zone"}`,
      PROOF_SIZE - PAD,
      PAD + 16,
      {
        size: 13,
        fill: COLOR.muted,
        anchor: "end",
      },
    );

  // ---------------------------------------------------------------- entry panel
  const entryTop = chartTop(LAYOUT.entryTop);
  const redactFrom = entryX + time.slot / 2;
  const entryPanel =
    rect(PAD, LAYOUT.entryTop, PROOF_SIZE - PAD * 2, LAYOUT.panelHeight, COLOR.surface, 'rx="12"') +
    panelHeader(
      "ENTRY",
      COLOR.accentBlue,
      stamp(input.entryFilledTime),
      `Entry ${formatPrice(input.entryFilledPrice, decimals)}`,
      COLOR.foreground,
      LAYOUT.entryTop,
    ) +
    panelChrome(input, entryY, entryTop, chartHeight) +
    candlesticks(input.candles, entryY, time) +
    // Everything after the fill is covered rather than cropped, so both panels
    // keep the same width and the same bars in the same places. Opaque: a
    // reveal that lets the outcome show through is not a reveal.
    rect(redactFrom, entryTop + 1, PLOT_X + PLOT_W - redactFrom, chartHeight - 2, COLOR.surface) +
    // The plan is drawn last so its levels stay legible across the hidden
    // stretch. Where the targets sit is the question; what price did is not.
    levels(input, entryY, entryTop, chartHeight, decimals) +
    `<line x1="${entryX.toFixed(1)}" y1="${entryTop}" x2="${entryX.toFixed(1)}" y2="${(entryTop + chartHeight).toFixed(1)}" stroke="${COLOR.accentBlue}" stroke-width="2"/>` +
    `<circle cx="${entryX.toFixed(1)}" cy="${entryY(input.entryFilledPrice).toFixed(1)}" r="4" fill="${COLOR.accentBlue}"/>`;

  // ---------------------------------------------------------------- result panel
  const resultTop = chartTop(LAYOUT.resultTop);
  const bandTop = Math.min(resultY(input.entryFilledPrice), resultY(input.targetReachedPrice));
  const bandHeight = Math.abs(resultY(input.targetReachedPrice) - resultY(input.entryFilledPrice));
  const resultPanel =
    rect(PAD, LAYOUT.resultTop, PROOF_SIZE - PAD * 2, LAYOUT.panelHeight, COLOR.surface, 'rx="12"') +
    panelHeader(
      "RESULT",
      COLOR.positive,
      stamp(input.targetReachedTime),
      `Take Profit ${formatPrice(input.targetReachedPrice, decimals)}  (${move >= 0 ? "+" : ""}${move}%)`,
      COLOR.positive,
      LAYOUT.resultTop,
    ) +
    panelChrome(input, resultY, resultTop, chartHeight) +
    // The stretch the trade actually earned, from the fill to the target.
    rect(entryX, bandTop, Math.max(0, targetX - entryX), bandHeight, COLOR.positive, 'opacity="0.16"') +
    candlesticks(input.candles, resultY, time) +
    levels(input, resultY, resultTop, chartHeight, decimals) +
    `<line x1="${entryX.toFixed(1)}" y1="${resultTop}" x2="${entryX.toFixed(1)}" y2="${(resultTop + chartHeight).toFixed(1)}" stroke="${COLOR.accentBlue}" stroke-width="1.5" stroke-dasharray="6 5" opacity="0.9"/>` +
    text("Entry Moment", entryX + 8, resultTop + 18, { size: 11, fill: COLOR.accentBlue });

  // ---------------------------------------------------------------- metrics
  const metrics: Array<[string, string, string]> = [
    ["CONFIDENCE", `${input.confidence}%`, COLOR.foreground],
    ["RISK / REWARD", `1 : ${input.riskReward.toFixed(0)}`, COLOR.foreground],
    ["DURATION", formatDuration(input.entryFilledTime, input.targetReachedTime), COLOR.foreground],
    ["RESULT", `${move >= 0 ? "+" : ""}${move}%`, move >= 0 ? COLOR.positive : COLOR.negative],
  ];
  const cellW = (PROOF_SIZE - PAD * 2) / metrics.length;
  const metricStrip =
    rect(PAD, LAYOUT.metricsTop, PROOF_SIZE - PAD * 2, LAYOUT.metricsHeight, COLOR.surface2, 'rx="12"') +
    metrics
      .map(([label, value, color], index) => {
        const cx = PAD + cellW * index + cellW / 2;
        const divider =
          index === 0
            ? ""
            : `<line x1="${(PAD + cellW * index).toFixed(1)}" y1="${LAYOUT.metricsTop + 22}" x2="${(PAD + cellW * index).toFixed(1)}" y2="${LAYOUT.metricsTop + LAYOUT.metricsHeight - 22}" stroke="${COLOR.border}" stroke-width="1"/>`;
        return (
          divider +
          text(label, cx, LAYOUT.metricsTop + 42, {
            size: 11,
            weight: 600,
            fill: COLOR.muted2,
            anchor: "middle",
          }) +
          text(value, cx, LAYOUT.metricsTop + 80, { size: 26, weight: 700, fill: color, anchor: "middle" })
        );
      })
      .join("");

  // ---------------------------------------------------------------- footer
  const footer = text(
    "Not Financial Advice · DYOR",
    PROOF_SIZE / 2,
    PROOF_SIZE - 34,
    { size: 12, fill: COLOR.muted2, anchor: "middle" },
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PROOF_SIZE}" height="${PROOF_SIZE}" viewBox="0 0 ${PROOF_SIZE} ${PROOF_SIZE}">` +
    rect(0, 0, PROOF_SIZE, PROOF_SIZE, COLOR.background) +
    header +
    entryPanel +
    resultPanel +
    metricStrip +
    footer +
    `</svg>`
  );
}

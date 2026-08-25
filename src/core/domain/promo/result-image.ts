import type { Candle } from "@/core/domain/models";
import { formatPrice, priceDecimals } from "@/shared/lib/format";

/**
 * Server-side rendering of the setup snapshots.
 *
 * Drawn as SVG rather than captured from the app, because the capture happens
 * on a schedule with no browser anywhere near it. Everything here is a pure
 * string transformation of numbers the scanner already has, which also means
 * the output can be asserted on directly instead of eyeballed.
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
  accent2: "#a78bfa",
  accentBlue: "#4f7cff",
  up: "#089981",
  down: "#f23645",
  positive: "#22c55e",
  negative: "#f43f5e",
} as const;

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const SNAPSHOT_WIDTH = 900;
export const SNAPSHOT_HEIGHT = 320;
const CHART_X = 16;
const CHART_Y = 44;
const CHART_W = 580;
const CHART_H = 258;
const PANEL_X = 612;
const PANEL_W = 272;

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
}

function text(value: string, x: number, y: number, options: TextOptions = {}): string {
  const { size = 11, weight = 500, fill = COLOR.foreground, anchor = "start" } = options;
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function rect(x: number, y: number, w: number, h: number, fill: string, extra = ""): string {
  return `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${fill}" ${extra}/>`;
}

export interface SnapshotSetup {
  direction: "long" | "short";
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  confidence: number;
  riskReward: number;
  status: string;
  zoneTop: number;
  zoneBottom: number;
}

export interface SnapshotInput {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  setup: SnapshotSetup;
  price: number;
  /** Shown under the symbol so a saved image says when it was taken. */
  capturedAt: string;
}

/**
 * Vertical scale for the chart.
 *
 * Spans the candles *and* every plan level. Scaling to the candles alone would
 * push a target that price has not reached yet off the top of the frame, which
 * is precisely the level a before-picture needs to show.
 */
function priceScale(candles: Candle[], setup: SnapshotSetup) {
  const values = [
    ...candles.map((candle) => candle.high),
    ...candles.map((candle) => candle.low),
    setup.entry,
    setup.target1,
    setup.target2,
    setup.stopLoss,
    setup.zoneTop,
    setup.zoneBottom,
  ].filter((value) => Number.isFinite(value));

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.06 || Math.abs(max) * 0.01 || 1;
  const low = min - pad;
  const high = max + pad;
  const span = high - low || 1;
  return {
    low,
    high,
    y: (price: number) => CHART_Y + CHART_H - ((price - low) / span) * CHART_H,
  };
}

function candlesticks(candles: Candle[], scale: ReturnType<typeof priceScale>): string {
  if (candles.length === 0) return "";
  const slot = CHART_W / candles.length;
  const body = Math.max(1, Math.min(7, slot * 0.62));

  return candles
    .map((candle, index) => {
      const cx = CHART_X + slot * (index + 0.5);
      const rising = candle.close >= candle.open;
      const color = rising ? COLOR.up : COLOR.down;
      const yHigh = scale.y(candle.high);
      const yLow = scale.y(candle.low);
      const yOpen = scale.y(candle.open);
      const yClose = scale.y(candle.close);
      const top = Math.min(yOpen, yClose);
      // A doji has no body to speak of; give it a hairline so the bar is
      // still visible instead of vanishing from the chart.
      const height = Math.max(1, Math.abs(yClose - yOpen));
      return (
        `<line x1="${cx.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="${color}" stroke-width="1"/>` +
        rect(cx - body / 2, top, body, height, color)
      );
    })
    .join("");
}

function levelLine(
  label: string,
  price: number,
  color: string,
  scale: ReturnType<typeof priceScale>,
  decimals: number,
): string {
  const y = scale.y(price);
  if (!Number.isFinite(y) || y < CHART_Y - 2 || y > CHART_Y + CHART_H + 2) return "";
  return (
    `<line x1="${CHART_X}" y1="${y.toFixed(1)}" x2="${CHART_X + CHART_W}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="4 4" opacity="0.9"/>` +
    rect(CHART_X + CHART_W - 96, y - 8, 94, 16, color, 'rx="3"') +
    text(`${label} ${formatPrice(price, decimals)}`, CHART_X + CHART_W - 49, y + 4, {
      size: 9,
      weight: 700,
      fill: "#06060a",
      anchor: "middle",
    })
  );
}

function planPanel(input: SnapshotInput, decimals: number): string {
  const { setup } = input;
  const bullish = setup.direction === "long";
  const rows: Array<[string, number, string]> = [
    ["Entry", setup.entry, COLOR.foreground],
    ["Target 1", setup.target1, COLOR.positive],
    ["Target 2", setup.target2, COLOR.positive],
    ["Invalidation (SL)", setup.stopLoss, COLOR.negative],
  ];

  const rowsMarkup = rows
    .map(([label, price, color], index) => {
      const y = 150 + index * 30;
      return (
        rect(PANEL_X + 12, y, PANEL_W - 24, 24, COLOR.surface3, 'rx="6"') +
        text(label, PANEL_X + 22, y + 16, { size: 10, fill: COLOR.muted }) +
        text(formatPrice(price, decimals), PANEL_X + PANEL_W - 22, y + 16, {
          size: 10,
          weight: 700,
          fill: color,
          anchor: "end",
        })
      );
    })
    .join("");

  return (
    rect(PANEL_X, CHART_Y, PANEL_W, CHART_H, COLOR.surface2, `rx="8" stroke="${COLOR.border}"`) +
    text("Trading Plan", PANEL_X + 12, CHART_Y + 22, { size: 11, weight: 600 }) +
    text(input.setup.status, PANEL_X + PANEL_W - 12, CHART_Y + 22, {
      size: 9,
      weight: 600,
      fill: COLOR.positive,
      anchor: "end",
    }) +
    text(bullish ? "Demand Zone" : "Supply Zone", PANEL_X + 12, CHART_Y + 48, {
      size: 16,
      weight: 700,
      fill: COLOR.accent2,
    }) +
    text(bullish ? "bullish" : "bearish", PANEL_X + 12, CHART_Y + 64, {
      size: 9,
      weight: 600,
      fill: bullish ? COLOR.positive : COLOR.negative,
    }) +
    rect(PANEL_X + 12, CHART_Y + 76, PANEL_W - 24, 40, COLOR.surface3, 'rx="6"') +
    text("CONFIDENCE", PANEL_X + 22, CHART_Y + 91, { size: 8, weight: 600, fill: COLOR.muted2 }) +
    text(`${setup.confidence}%`, PANEL_X + 22, CHART_Y + 108, { size: 14, weight: 700 }) +
    text("RISK-REWARD", PANEL_X + PANEL_W - 22, CHART_Y + 91, {
      size: 8,
      weight: 600,
      fill: COLOR.muted2,
      anchor: "end",
    }) +
    text(`1 : ${setup.riskReward.toFixed(0)}`, PANEL_X + PANEL_W - 22, CHART_Y + 108, {
      size: 14,
      weight: 700,
      anchor: "end",
    }) +
    text("TRADE BREAKDOWN", PANEL_X + 12, 142, { size: 8, weight: 600, fill: COLOR.muted2 }) +
    rowsMarkup
  );
}

/** One snapshot: chart on the left, the plan beside it. */
export function snapshotBody(input: SnapshotInput): string {
  const decimals = priceDecimals(input.price);
  const scale = priceScale(input.candles, input.setup);
  const { setup } = input;
  const zoneTopY = scale.y(Math.max(setup.zoneTop, setup.zoneBottom));
  const zoneBottomY = scale.y(Math.min(setup.zoneTop, setup.zoneBottom));

  return (
    rect(0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT, COLOR.surface, 'rx="10"') +
    text(input.symbol, 16, 26, { size: 15, weight: 700 }) +
    text(`${input.timeframe} · ${input.capturedAt}`, 16, 38, { size: 9, fill: COLOR.muted2 }) +
    text(formatPrice(input.price, decimals), SNAPSHOT_WIDTH - 16, 26, {
      size: 14,
      weight: 700,
      anchor: "end",
    }) +
    rect(CHART_X, CHART_Y, CHART_W, CHART_H, COLOR.background, `rx="6" stroke="${COLOR.border}"`) +
    // The zone spans the full width: it is a price band, not an event at one bar.
    rect(
      CHART_X,
      zoneTopY,
      CHART_W,
      zoneBottomY - zoneTopY,
      setup.direction === "long" ? COLOR.positive : COLOR.negative,
      'opacity="0.14"',
    ) +
    candlesticks(input.candles, scale) +
    levelLine("Entry", setup.entry, COLOR.accentBlue, scale, decimals) +
    levelLine("T1", setup.target1, COLOR.positive, scale, decimals) +
    levelLine("T2", setup.target2, COLOR.positive, scale, decimals) +
    levelLine("SL", setup.stopLoss, COLOR.negative, scale, decimals) +
    planPanel(input, decimals)
  );
}

/** A snapshot on its own, as a standalone document. */
export function renderSnapshotSvg(input: SnapshotInput): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SNAPSHOT_WIDTH}" height="${SNAPSHOT_HEIGHT}" viewBox="0 0 ${SNAPSHOT_WIDTH} ${SNAPSHOT_HEIGHT}">` +
    rect(0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT, COLOR.background) +
    snapshotBody(input) +
    `</svg>`
  );
}

const COMPOSE_PADDING = 24;
const COMPOSE_HEADER = 92;
const COMPOSE_GAP = 20;
const COMPOSE_FOOTER = 44;
const CAPTION_HEIGHT = 22;

export interface ComposeInput {
  symbol: string;
  entry: SnapshotInput;
  result: SnapshotInput;
  /** Wordmark as a data URI, so the file stands alone. */
  logoHref?: string;
}

/**
 * The published proof: before above, after below.
 *
 * Stacked rather than side by side because the two charts share a price axis
 * conceptually — reading down the page is reading forward in time — and side
 * by side at this width would shrink each chart past the point of being
 * readable.
 */
export function composeResultImage(input: ComposeInput): string {
  const width = SNAPSHOT_WIDTH + COMPOSE_PADDING * 2;
  const bodyTop = COMPOSE_HEADER;
  const blockHeight = CAPTION_HEIGHT + SNAPSHOT_HEIGHT;
  const height = bodyTop + blockHeight * 2 + COMPOSE_GAP + COMPOSE_FOOTER;

  const block = (label: string, snapshot: SnapshotInput, top: number) =>
    `<g transform="translate(${COMPOSE_PADDING}, ${top})">` +
    text(label, 0, 14, { size: 11, weight: 700, fill: COLOR.muted }) +
    `<g transform="translate(0, ${CAPTION_HEIGHT})">${snapshotBody(snapshot)}</g>` +
    `</g>`;

  const logo = input.logoHref
    ? `<image href="${escapeXml(input.logoHref)}" x="${COMPOSE_PADDING}" y="22" width="132" height="30"/>`
    : text("Coin Secret", COMPOSE_PADDING, 44, { size: 20, weight: 700 });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    rect(0, 0, width, height, COLOR.background) +
    logo +
    text(`${input.symbol.toUpperCase()} RESULT`, width / 2, 70, {
      size: 22,
      weight: 700,
      anchor: "middle",
    }) +
    block("ENTRY SNAPSHOT", input.entry, bodyTop) +
    block("RESULT SNAPSHOT", input.result, bodyTop + blockHeight + COMPOSE_GAP) +
    text("coinsecret · analisis teknikal berbasis aturan, bukan nasihat investasi", width / 2, height - 18, {
      size: 10,
      fill: COLOR.muted2,
      anchor: "middle",
    }) +
    `</svg>`
  );
}

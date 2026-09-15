import type { Candle } from "@/core/domain/models";


/**
 * The shareable result card.
 *
 * Replaces the two-panel proof image. That one argued the case — before and
 * after, on a shared axis — and took a square to do it. This one states the
 * outcome: which pair, how it ended, by how much, and the three figures that
 * qualify it. It is built to be read at a glance in a feed.
 *
 * Drawn as SVG because the capture runs on a schedule with no browser near it,
 * and because every coordinate is then a number a test can check.
 */

const COLOR = {
  ink: "#f4f7ff",
  muted: "#8a93a8",
  faint: "#5b6478",
  positive: "#22c55e",
  negative: "#f43f5e",
  bar: "#111a2e",
} as const;

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const PNL_WIDTH = 1356;
export const PNL_HEIGHT = 800;

export interface PnlInput {
  symbol: string;
  /** What price made of the plan: the terminal status, already decided. */
  outcome: "target" | "stop";
  entryPrice: number;
  exitPrice: number;
  direction: "long" | "short";
  confidence: number;
  riskReward: number;
  entryTime: number;
  exitTime: number;
  /** Wordmark as a data URI, so the file stands alone once saved. */
  logoHref?: string;
  /** Shown bottom right. The place a reader can go and check. */
  domain?: string;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Move from entry to exit, signed in the trade's favour.
 *
 * A short that fell is a gain. Printing the raw move would call a win a loss on
 * the one image built to be shared.
 */
export function pnlPercent(input: PnlInput): number {
  const raw = ((input.exitPrice - input.entryPrice) / input.entryPrice) * 100;
  return Number((input.direction === "short" ? -raw : raw).toFixed(2));
}

/** `5 Hours` — whole hours, which is the resolution anyone reads this at. */
export function formatDuration(fromSeconds: number, toSeconds: number): string {
  const hours = Math.max(0, Math.round((toSeconds - fromSeconds) / 3600));
  if (hours < 48) return `${hours} ${hours === 1 ? "Hour" : "Hours"}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "Day" : "Days"}`;
}

/** `10-09-2026` — the day the trade closed. */
export function formatCardDate(seconds: number): string {
  const date = new Date(seconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;
}

function text(
  body: string,
  x: number,
  y: number,
  options: { size: number; weight?: number; fill?: string; anchor?: string; spacing?: number } = {
    size: 14,
  },
): string {
  const anchor = options.anchor ? ` text-anchor="${options.anchor}"` : "";
  const spacing = options.spacing ? ` letter-spacing="${options.spacing}"` : "";
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${options.size}" font-weight="${
    options.weight ?? 400
  }" fill="${options.fill ?? COLOR.ink}"${anchor}${spacing}>${escapeXml(body)}</text>`;
}

/**
 * The block of rectangles behind the right-hand side.
 *
 * A quiet suggestion of a rising chart rather than a real one: the card's claim
 * is the number, and a real series here would invite the reader to read a
 * second, unlabelled one.
 */
function backdrop(): string {
  const columns = [
    { x: 760, y: 512, w: 100, h: 288 },
    { x: 860, y: 372, w: 100, h: 428 },
    { x: 960, y: 232, w: 100, h: 568 },
    { x: 1060, y: 512, w: 100, h: 288 },
    { x: 1160, y: 372, w: 100, h: 428 },
    { x: 1260, y: 232, w: 96, h: 568 },
  ];
  return columns
    .map(
      (column, index) =>
        `<rect x="${column.x}" y="${column.y}" width="${column.w}" height="${column.h}" fill="${
          COLOR.bar
        }" opacity="${index % 2 === 0 ? 0.55 : 0.32}"/>`,
    )
    .join("");
}

/**
 * The finished card.
 *
 * Two columns: the claim on the left, the decorative field on the right. The
 * left column never crosses x=740, so the backdrop can never sit under a word.
 */
export function composePnlCard(input: PnlInput): string {
  const move = pnlPercent(input);
  const won = move >= 0;
  const tone = won ? COLOR.positive : COLOR.negative;
  const base = input.symbol.replace(/USDT$/i, "");

  const logo = input.logoHref
    ? `<image href="${escapeXml(input.logoHref)}" x="88" y="86" width="${Math.round(
        (44 * 844) / 105,
      )}" height="44"/>`
    : text("CoinSecret", 88, 122, { size: 40, weight: 700 });

  const outcomeLabel = input.outcome === "target" ? "Target 2 Reached" : "Stop Loss/Invalid";

  const metrics: Array<[string, string]> = [
    ["Confidence", `${Math.round(input.confidence)}%`],
    ["Risk/Reward", `1:${Math.round(input.riskReward)}`],
    ["Duration", formatDuration(input.entryTime, input.exitTime)],
  ];

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PNL_WIDTH}" height="${PNL_HEIGHT}" viewBox="0 0 ${PNL_WIDTH} ${PNL_HEIGHT}">` +
    `<defs><linearGradient id="pnl-bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="#0d1526"/><stop offset="55%" stop-color="#070b14"/>` +
    `<stop offset="100%" stop-color="#05070d"/></linearGradient></defs>` +
    `<rect width="${PNL_WIDTH}" height="${PNL_HEIGHT}" fill="url(#pnl-bg)"/>` +
    backdrop() +
    logo +
    text(formatCardDate(input.exitTime), PNL_WIDTH - 88, 122, {
      size: 21,
      weight: 500,
      fill: COLOR.ink,
      anchor: "end",
      spacing: 1.5,
    }) +
    // The pair, and what became of it.
    `<circle cx="135" cy="354" r="40" fill="${COLOR.bar}"/>` +
    text(base.slice(0, 3), 135, 366, {
      size: 24,
      weight: 700,
      fill: COLOR.ink,
      anchor: "middle",
    }) +
    text(`${base}/USDT`, 211, 344, { size: 30, weight: 600, spacing: 1 }) +
    text(outcomeLabel, 211, 384, { size: 20, weight: 400, fill: COLOR.muted }) +
    // The claim.
    text(`${won ? "+" : ""}${move}%`, 88, 545, { size: 104, weight: 700, fill: tone }) +
    // What qualifies it.
    metrics
      .map(([label, value], index) => {
        const x = 90 + index * 174;
        return (
          text(label, x, 636, { size: 18, weight: 400, fill: COLOR.muted }) +
          text(value, x, 682, { size: 28, weight: 600, spacing: 0.5 })
        );
      })
      .join("") +
    // Where to go and check.
    text(input.domain ?? "coinsecret.vercel.app", PNL_WIDTH - 88, 696, {
      size: 19,
      weight: 400,
      fill: COLOR.faint,
      anchor: "end",
    }) +
    `</svg>`
  );
}

/** Candles are not drawn on this card; the type is kept for callers' payloads. */
export type PnlCandles = Candle[];

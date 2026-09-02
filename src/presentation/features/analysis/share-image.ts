import type { PatternSummary, TradeLevel } from "@/core/domain/models";
import { formatPrice, priceDecimals } from "@/shared/lib/format";

/** Palette mirrored from the app tokens so the export matches the product. */
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
  accent2: "#a78bfa",
  positive: "#22c55e",
  negative: "#f43f5e",
  warning: "#f59e0b",
} as const;

/**
 * Wordmark drawn top-right, where a masthead is read first.
 *
 * Larger than the footer version it replaces: at 22px the name was legible
 * only at full size, and these images are mostly looked at scaled down in a
 * chat thread.
 */
const LOGO_SRC = "/logo/logo-text.png";
const LOGO_HEIGHT = 34;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 844) / 105);

/**
 * Loads the wordmark, resolving to null instead of rejecting.
 *
 * The image is the point of the export; a logo that failed to decode is not a
 * reason to hand the reader nothing.
 */
function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.width = LOGO_WIDTH;
    image.height = LOGO_HEIGHT;
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = LOGO_SRC;
  });
}

const PANEL_WIDTH = 380;
const PADDING = 24;
const GAP = 20;

/**
 * Fixed export box for the chart.
 *
 * The on-screen chart is only as wide as the reader's window allows, which on
 * a narrow layout is a few hundred pixels. Exporting at that size produced a
 * lopsided picture next to the trade plan, so the chart is fitted into a
 * constant box instead and the shared image always has the same proportions.
 */
const CHART_BOX_WIDTH = 720;
/**
 * Chart height in the export.
 *
 * Was 560 to leave room for a performance block beneath the trade plan. That
 * block is gone: the plan and its levels are what the picture is for, and a
 * second reading of the same setup underneath only invited the two to
 * disagree.
 */
const CHART_BOX_HEIGHT = 470;

/** Rendered above 1x so text and candles stay crisp when the image is opened. */
const EXPORT_SCALE = 2;

export interface ShareImageInput {
  chart: HTMLCanvasElement;
  symbol: string;
  timeframe: string;
  price: number;
  change24h: number;
  pattern: PatternSummary;
  levels: TradeLevel[];
  riskReward: number;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = COLOR.surface2;
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = COLOR.border;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Warning triangle drawn as vectors — emoji coverage in canvas is uneven. */
function warningTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const half = size / 2;
  ctx.save();
  ctx.strokeStyle = COLOR.warning;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + half, y);
  ctx.lineTo(x + size, y + size);
  ctx.lineTo(x, y + size);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = COLOR.warning;
  ctx.fillRect(x + half - 0.7, y + size * 0.38, 1.4, size * 0.32);
  ctx.fillRect(x + half - 0.7, y + size * 0.78, 1.4, 1.4);
  ctx.restore();
}

/**
 * Closes since the signal, drawn as a line.
 *
 * Scaled to its own min/max rather than to the price axis: the point is the
 * shape of what happened after the call, and on a 0.4% move against a full
 * price scale that shape would be a flat line.
 */

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: { size?: number; weight?: string; color?: string; align?: CanvasTextAlign } = {},
): void {
  ctx.font = `${options.weight ?? "500"} ${options.size ?? 13}px Inter, system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = options.color ?? COLOR.foreground;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}

/**
 * Renders the chart together with its trade plan into a single shareable
 * image. Deliberately excludes the surrounding app chrome — navigation,
 * search, account state — so the picture carries only what a reader needs to
 * judge the setup.
 */
export async function composeShareImage(input: ShareImageInput): Promise<Blob | null> {
  const logo = await loadLogo();
  const scale = EXPORT_SCALE;
  const chartWidth = CHART_BOX_WIDTH;
  const chartHeight = CHART_BOX_HEIGHT;

  // Fit the captured chart inside the box without distorting it.
  const sourceWidth = Math.max(1, input.chart.width);
  const sourceHeight = Math.max(1, input.chart.height);
  const fit = Math.min(CHART_BOX_WIDTH / sourceWidth, CHART_BOX_HEIGHT / sourceHeight);
  const drawWidth = sourceWidth * fit;
  const drawHeight = sourceHeight * fit;

  const width = PADDING * 2 + chartWidth + GAP + PANEL_WIDTH;
  const headerHeight = 64;
  const footerHeight = 34;
  const height = PADDING * 2 + headerHeight + chartHeight + footerHeight;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);

  ctx.fillStyle = COLOR.background;
  ctx.fillRect(0, 0, width, height);

  // Header: symbol and price on the left, wordmark on the right. Price used to
  // sit at the right edge; the logo now holds that spot, so the two share one
  // line instead of fighting for it.
  const positive = input.change24h >= 0;
  const decimals = priceDecimals(input.price);
  text(ctx, input.symbol, PADDING, PADDING + 24, { size: 22, weight: "700" });
  let headerCursor = PADDING + ctx.measureText(input.symbol).width + 14;
  text(ctx, `$${formatPrice(input.price, decimals)}`, headerCursor, PADDING + 24, {
    size: 19,
    weight: "700",
  });
  headerCursor += ctx.measureText(`$${formatPrice(input.price, decimals)}`).width + 10;
  text(ctx, `${positive ? "+" : ""}${input.change24h.toFixed(2)}%`, headerCursor, PADDING + 24, {
    size: 13,
    weight: "600",
    color: positive ? COLOR.positive : COLOR.negative,
  });
  text(ctx, input.timeframe, PADDING, PADDING + 44, { size: 12, color: COLOR.muted2 });

  if (logo) {
    ctx.drawImage(logo, width - PADDING - LOGO_WIDTH, PADDING + 4, LOGO_WIDTH, LOGO_HEIGHT);
  }

  // Chart.
  const chartTop = PADDING + headerHeight;
  ctx.save();
  roundedRect(ctx, PADDING, chartTop, chartWidth, chartHeight, 10);
  ctx.clip();
  ctx.fillStyle = COLOR.surface;
  ctx.fillRect(PADDING, chartTop, chartWidth, chartHeight);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    input.chart,
    PADDING + (chartWidth - drawWidth) / 2,
    chartTop + (chartHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  ctx.restore();
  ctx.strokeStyle = COLOR.border;
  ctx.lineWidth = 1;
  roundedRect(ctx, PADDING, chartTop, chartWidth, chartHeight, 10);
  ctx.stroke();

  // Trade plan panel.
  const panelX = PADDING + chartWidth + GAP;
  const panelHeight = chartHeight;
  panel(ctx, panelX, chartTop, PANEL_WIDTH, panelHeight);

  const innerX = panelX + 16;
  const innerWidth = PANEL_WIDTH - 32;
  let cursor = chartTop + 28;

  text(ctx, "Trading Plan", innerX, cursor, { size: 13, weight: "600" });
  text(ctx, input.pattern.status, panelX + PANEL_WIDTH - 16, cursor, {
    size: 11,
    weight: "600",
    color: COLOR.positive,
    align: "right",
  });

  cursor += 30;
  text(ctx, input.pattern.name, innerX, cursor, { size: 19, weight: "700", color: COLOR.accent2 });
  cursor += 20;
  text(ctx, input.pattern.trend, innerX, cursor, {
    size: 11,
    weight: "600",
    color: input.pattern.trend === "bearish" ? COLOR.negative : COLOR.positive,
  });

  // Four stat tiles, two per row.
  cursor += 16;
  const tileW = (innerWidth - 10) / 2;
  const tileH = 54;
  const stats: [string, string, string?][] = [
    ["CONFIDENCE", `${input.pattern.confidence}%`],
    ["RISK LEVEL", input.pattern.riskLevel],
  ];
  stats.forEach((stat, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = innerX + col * (tileW + 10);
    const y = cursor + row * (tileH + 10);
    ctx.fillStyle = COLOR.surface3;
    roundedRect(ctx, x, y, tileW, tileH, 8);
    ctx.fill();
    ctx.strokeStyle = COLOR.border;
    ctx.stroke();
    text(ctx, stat[0], x + 10, y + 18, { size: 9, weight: "600", color: COLOR.muted2 });
    text(ctx, stat[1], x + 10, y + 40, { size: 17, weight: "700" });
    if (stat[2]) text(ctx, stat[2], x + 10 + ctx.measureText(stat[1]).width + 34, y + 40, { size: 10, color: COLOR.muted2 });
  });

  cursor += tileH * Math.ceil(stats.length / 2) + (stats.length > 2 ? 10 : 0) + 32;
  text(ctx, "TRADE BREAKDOWN", innerX, cursor, { size: 10, weight: "600", color: COLOR.muted2 });
  cursor += 14;

  const priceDp = priceDecimals(input.price);
  for (const level of input.levels) {
    const rowH = 32;
    ctx.fillStyle = COLOR.surface3;
    roundedRect(ctx, innerX, cursor, innerWidth, rowH, 8);
    ctx.fill();
    ctx.strokeStyle = COLOR.border;
    ctx.stroke();
    text(ctx, level.label, innerX + 10, cursor + 21, { size: 12, color: COLOR.muted });
    const isStop = level.id === "sl";
    text(ctx, `$${formatPrice(level.price, priceDp)}`, innerX + innerWidth - 10, cursor + 21, {
      size: 12,
      weight: "600",
      color: isStop ? COLOR.negative : level.changeFromPrice > 0 ? COLOR.positive : COLOR.foreground,
      align: "right",
    });
    cursor += rowH + 6;
  }

  // Risk-reward closes the plan.
  ctx.fillStyle = COLOR.accent;
  ctx.globalAlpha = 0.16;
  roundedRect(ctx, innerX, cursor, innerWidth, 34, 8);
  ctx.fill();
  ctx.globalAlpha = 1;
  text(ctx, "Risk-Reward Ratio", innerX + 10, cursor + 22, { size: 12, color: COLOR.muted });
  text(ctx, `1 : ${input.riskReward.toFixed(0)}`, innerX + innerWidth - 10, cursor + 22, {
    size: 13,
    weight: "700",
    align: "right",
  });

  // Footer: the standing reminder on the left, the wordmark on the right.
  const footerBaseline = height - PADDING + 6;
  warningTriangle(ctx, PADDING, footerBaseline - 11, 12);
  text(
    ctx,
    "Selalu lakukan riset dan analisa ulang secara mandiri!",
    PADDING + 18,
    footerBaseline,
    { size: 11, weight: "600", color: COLOR.warning },
  );

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

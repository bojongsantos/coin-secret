import type {
  AnalysisResult,
  Candle,
  PatternSummary,
  PerformanceStats,
  ReasoningSection,
  Timeframe,
  TradeLevel,
} from "@/core/domain/models";
import type { MarketTicker } from "@/core/domain/models";
import {
  detectSupplyDemand,
  readPublishedSetup,
  type PublishedSetup,
} from "@/core/domain/analysis/supply-demand";
import { formatPrice } from "@/shared/lib/format";

export function emaSeries(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = closes[0] ?? 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      out.push(closes[0]);
      continue;
    }
    prev = closes[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsiSeries(closes: number[], period = 14): number[] {
  if (closes.length === 0) return [];
  const out: number[] = [50];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) {
        out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
      } else {
        out.push(50);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    }
  }
  return out;
}

function pct(a: number, b: number): number {
  return ((a - b) / b) * 100;
}

export interface ReasoningContext {
  /** Setup name shown in the header, e.g. "Demand Zone (78%)". */
  sdName: string;
  confidence: number;
  pair?: string;
  direction?: "long" | "short";
  entry?: number;
  target1?: number;
  target2?: number;
  stopLoss?: number;
  status?: string;
  bias?: "bullish" | "bearish" | "neutral";
  support?: number;
  resistance?: number;
  /** Zone quality, so the risk block can cite it instead of asserting it. */
  zoneStrength?: "fresh" | "tested" | "broken";
  zoneTouches?: number;
}

/**
 * Average True Range over `period` bars.
 *
 * The risk block measures the stop against it: a stop tighter than one ATR sits
 * inside ordinary bar-to-bar noise, which is a different kind of risk from a
 * stop that is simply far away.
 */
export function averageTrueRange(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const window = candles.slice(-(period + 1));
  let sum = 0;
  let count = 0;
  for (let i = 1; i < window.length; i++) {
    const previousClose = window[i - 1].close;
    sum += Math.max(
      window[i].high - window[i].low,
      Math.abs(window[i].high - previousClose),
      Math.abs(window[i].low - previousClose),
    );
    count++;
  }
  return count ? sum / count : 0;
}

export function buildReasoning(candles: Candle[], ctx: ReasoningContext): ReasoningSection[] {
  const closes = candles.map((c) => c.close);
  const ema50 = emaSeries(closes, 50);
  const ema20 = emaSeries(closes, 20);
  const rsi = rsiSeries(closes, 14);
  const last = candles[candles.length - 1];
  const price = last.close;
  const rsiNow = rsi[rsi.length - 1];
  const range = candles.slice(-50);
  const high = Math.max(...range.map((c) => c.high));
  const low = Math.min(...range.map((c) => c.low));

  const { direction, entry, target1, target2, stopLoss, status, bias, support, resistance } = ctx;
  const isLong = direction !== "short";
  const biasLabel = bias === "bullish" ? "bullish" : bias === "bearish" ? "bearish" : "netral";

  const aboveEma20 = price >= ema20[ema20.length - 1];
  const aboveEma50 = price >= ema50[ema50.length - 1];
  const structure =
    aboveEma20 && aboveEma50 && ema20[ema20.length - 1] >= ema50[ema50.length - 1]
      ? "bullish"
      : !aboveEma20 && !aboveEma50 && ema20[ema20.length - 1] <= ema50[ema50.length - 1]
        ? "bearish"
        : "sideways";

  const riskReward =
    entry && target2 && stopLoss && Math.abs(entry - stopLoss) > 1e-9
      ? Math.abs(target2 - entry) / Math.abs(entry - stopLoss)
      : undefined;

  // Risk Management is derived from this setup's own numbers rather than a
  // fixed checklist. A generic list reads the same for a 0.3% stop and a 9%
  // stop, which is exactly when the reader most needs the difference.
  const atr = averageTrueRange(candles);
  const riskPoints: string[] = [];

  if (entry && stopLoss && Math.abs(entry - stopLoss) > 1e-9) {
    const stopDistance = Math.abs(entry - stopLoss);
    const stopPct = (stopDistance / entry) * 100;
    const stopAtr = atr > 1e-9 ? stopDistance / atr : 0;

    riskPoints.push(
      `Stop loss **${formatPrice(stopLoss)}** berjarak **${stopPct.toFixed(2)}%** dari entry **${formatPrice(entry)}**.`,
    );

    if (stopAtr > 0) {
      riskPoints.push(
        stopAtr < 1
          ? `Jarak stop hanya **${stopAtr.toFixed(1)}×ATR(14)**, masih di dalam ayunan normal, sehingga rawan tersentuh noise.`
          : `Jarak stop **${stopAtr.toFixed(1)}×ATR(14)**, berada di luar ayunan normal pada timeframe ini.`,
      );
    }

    // Position size that keeps one loss at 1% of capital.
    const sizePct = Math.min(100, (1 / stopPct) * 100);
    riskPoints.push(
      `Dengan risiko **1% modal** per posisi, ukuran posisi maksimal **${sizePct.toFixed(1)}%** dari modal.`,
    );
  }

  if (riskReward !== undefined) {
    riskPoints.push(
      riskReward >= 2
        ? `Risk-Reward **1:${riskReward.toFixed(1)}** memenuhi ambang minimum 1:2.`
        : `Risk-Reward **1:${riskReward.toFixed(1)}** berada di bawah ambang 1:2, sehingga setup ini menuntut win rate lebih tinggi.`,
    );
  }

  if (ctx.zoneStrength) {
    const touches = ctx.zoneTouches ?? 0;
    riskPoints.push(
      ctx.zoneStrength === "fresh"
        ? `Zona belum pernah disentuh ulang, sehingga likuiditas di dalamnya masih utuh.`
        : `Zona sudah tersentuh **${touches}×**; tiap sentuhan mengikis likuiditas yang tersisa dan menurunkan confidence ke **${ctx.confidence}%**.`,
    );
  }

  if (entry) {
    const gapPct = ((price - entry) / entry) * 100;
    riskPoints.push(
      Math.abs(gapPct) < 0.05
        ? `Harga **${formatPrice(price)}** sudah berada tepat pada entry.`
        : `Harga **${formatPrice(price)}** masih **${Math.abs(gapPct).toFixed(2)}%** ${gapPct > 0 ? "di atas" : "di bawah"} entry, jadi posisi dipasang sebagai limit order, bukan market.`,
    );
  }

  if (stopLoss) {
    riskPoints.push(
      `Setup batal apabila candle ditutup ${isLong ? "di bawah" : "di atas"} **${formatPrice(stopLoss)}**.`,
    );
  }

  if (riskPoints.length === 0) {
    riskPoints.push(
      `Belum ada level entry maupun stop yang valid, sehingga belum ada risiko yang dapat diukur.`,
    );
  }

  const summaryZone =
    ctx.sdName.includes("Demand") || ctx.sdName.includes("Demand Zone")
      ? "demand"
      : ctx.sdName.includes("Supply")
        ? "supply"
        : null;

  return [
    {
      id: "summary",
      title: "Ringkasan Setup",
      points: [
        summaryZone
          ? `Zona ${summaryZone} aktif pada ${ctx.pair ?? "aset"}. Arah setup ${isLong ? "long" : "short"}.`
          : `Belum terdapat zona supply atau demand yang valid.`,
        summaryZone ? `Confidence **${ctx.confidence}%**.` : "",
        direction && entry
          ? `Entry **${formatPrice(entry)}**. Stop loss **${formatPrice(stopLoss ?? 0)}**.`
          : `Bias pasar ${biasLabel}.`,
        direction && entry
          ? `Target **${formatPrice(target1 ?? 0)}** dan **${formatPrice(target2 ?? 0)}**.`
          : `Support **${formatPrice(support ?? 0)}**. Resistance **${formatPrice(resistance ?? 0)}**.`,
        status ? `Status setup: ${status}.` : "",
      ].filter(Boolean),
    },
    {
      id: "structure",
      title: "Market Structure",
      points: [
        `Harga berada di ${aboveEma20 ? "atas" : "bawah"} EMA 20.`,
        `Harga berada di ${aboveEma50 ? "atas" : "bawah"} EMA 50.`,
        `Struktur pasar ${structure}.`,
      ],
    },
    {
      id: "levels",
      title: "Key Level",
      points: [
        `Resistance terdekat **${formatPrice(resistance ?? high)}**.`,
        `Support terdekat **${formatPrice(support ?? low)}**.`,
      ],
    },
    {
      id: "momentum",
      title: "Momentum",
      points: [
        `RSI(14) **${rsiNow.toFixed(0)}** menunjukkan momentum ${
          rsiNow > 50 ? "bullish" : rsiNow < 50 ? "bearish" : "netral"
        }.`,
        riskReward !== undefined
          ? `Risk-Reward **1:${Math.round(riskReward)}**.`
          : "",
      ].filter(Boolean),
    },
    {
      id: "risk",
      title: "Risk Management",
      points: riskPoints,
    },
  ];
}

export function buildPerformance(candles: Candle[]): PerformanceStats {
  const outcomes: Array<{ win: boolean; returnPct: number }> = [];
  const seenZones = new Set<string>();
  const horizon = 12;

  // Walk forward without future leakage. Each setup only sees candles that
  // existed at its evaluation point, then uses the next 12 bars as outcome.
  for (let end = 40; end < candles.length - horizon; end += 3) {
    const result = detectSupplyDemand(candles.slice(0, end));
    const setup = result.setup;
    if (!setup) continue;
    const key = `${setup.direction}:${setup.zone.baseTime}`;
    if (seenZones.has(key)) continue;
    seenZones.add(key);

    let filled = false;
    let resolved = false;
    for (const candle of candles.slice(end, end + horizon)) {
      const isLong = setup.direction === "long";
      if (!filled && (isLong ? candle.low <= setup.entry : candle.high >= setup.entry)) {
        filled = true;
      }
      if (!filled) continue;

      // When both levels occur in one candle, use the conservative SL result.
      const stopped = isLong ? candle.low <= setup.stopLoss : candle.high >= setup.stopLoss;
      const targeted = isLong ? candle.high >= setup.target2 : candle.low <= setup.target2;
      if (stopped) {
        outcomes.push({ win: false, returnPct: Math.abs(pct(setup.stopLoss, setup.entry)) });
        resolved = true;
        break;
      }
      if (targeted) {
        outcomes.push({ win: true, returnPct: Math.abs(pct(setup.target2, setup.entry)) });
        resolved = true;
        break;
      }
    }
    if (!resolved) continue;
  }

  const wins = outcomes.filter((outcome) => outcome.win);
  const losses = outcomes.filter((outcome) => !outcome.win);
  const total = outcomes.length;
  const successRate = total ? Math.round((wins.length / total) * 100) : 0;
  const avgGain = wins.length ? wins.reduce((sum, outcome) => sum + outcome.returnPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((sum, outcome) => sum + outcome.returnPct, 0) / losses.length : 0;
  const grossGain = wins.reduce((sum, outcome) => sum + outcome.returnPct, 0);
  const grossLoss = losses.reduce((sum, outcome) => sum + outcome.returnPct, 0);
  const profitFactor = grossLoss > 0 ? grossGain / grossLoss : grossGain > 0 ? 6 : 0;

  return {
    successRate,
    totalTrades: total,
    avgGain: Number(avgGain.toFixed(1)),
    avgLoss: Number(avgLoss.toFixed(1)),
    profitFactor: Number(Math.max(0, Math.min(6, profitFactor)).toFixed(1)),
    breakdown: [
      { label: "Target 2", value: successRate, color: "positive" },
      { label: "Stop loss", value: total ? 100 - successRate : 0, color: "negative" },
    ],
  };
}

export function buildAnalysisResult(
  symbol: string,
  base: string,
  quote: string,
  timeframe: Timeframe,
  exchange: string,
  candles: Candle[],
  ticker: MarketTicker,
  /**
   * The setup already published for this symbol, when there is one.
   *
   * Given precedence over anything the detector would pick now. The table and
   * the chart have to be looking at the same plan, and the published one is
   * the plan the reader was handed.
   */
  published?: PublishedSetup | null,
): AnalysisResult {
  const price = ticker.lastPrice;
  const now = new Date();
  const analyzedAt = now.toISOString();

  const detected = detectSupplyDemand(candles);
  const reading = published ? readPublishedSetup(candles, published, price) : null;
  // A published setup that price has finished falls back to the detector, so
  // the chart moves on at the same moment the board does.
  const sd = reading?.setup ? { ...detected, setup: reading.setup } : detected;
  const setup = sd.setup;
  const performance = buildPerformance(candles);

  const zoneShape = sd.zones
    .slice(0, 8)
    .map((z) => ({
      id: z.id,
      type: z.type,
      top: z.top,
      bottom: z.bottom,
      baseTime: z.baseTime,
      strength: z.strength,
      active: z.active,
      confidence: z.confidence,
      narrowness: z.narrowness,
      touches: z.touches,
    }));

  // Always include the setup zone (the limit-order reference zone) so the chart
  // draws it full-width, even when it fell outside the first eight zones.
  if (setup && !zoneShape.some((z) => z.id === setup.zone.id)) {
    zoneShape.push({
      id: setup.zone.id,
      type: setup.zone.type,
      top: setup.zone.top,
      bottom: setup.zone.bottom,
      baseTime: setup.zone.baseTime,
      strength: setup.zone.strength,
      active: setup.zone.active,
      confidence: setup.zone.confidence,
      narrowness: setup.zone.narrowness,
      touches: setup.zone.touches,
    });
  }

  const shape = setup
    ? {
        zones: zoneShape,
        setup: {
          direction: setup.direction,
          entry: setup.entry,
          target1: setup.target1,
          target2: setup.target2,
          stopLoss: setup.stopLoss,
          riskReward: setup.riskReward,
          confidence: setup.confidence,
          zoneId: setup.zone.id,
        },
        bias: sd.bias,
        support: sd.support,
        resistance: sd.resistance,
      }
    : { zones: zoneShape, bias: sd.bias, support: sd.support, resistance: sd.resistance };

  if (!setup) {
    return {
      pair: { symbol, base, quote, name: `${base}/${quote}`, price, change24h: ticker.priceChangePercent },
      timeframe,
      exchange,
      analyzedAt,
      chartData: { symbol, timeframe, candles },
      pattern: {
        id: `none-${symbol.toLowerCase()}`,
        name: "No Zone Setup",
        symbol,
        confidence: 0,
        trend: "neutral",
        status: "—",
        probability: 0,
        riskLevel: "medium",
        timeframe,
        exchange,
        detectedAt: analyzedAt,
        shape,
      },
      levels: [],
      riskReward: 0,
      reasoning: buildReasoning(candles, {
        sdName: "No Zone Setup",
        confidence: 0,
        pair: `${base}/${quote}`,
        bias: sd.bias,
        support: sd.support,
        resistance: sd.resistance,
      }),
    };
  }

  const levels: TradeLevel[] = [
    {
      id: "entry",
      label: "Entry",
      shortLabel: "Entry",
      price: setup.entry,
      changeFromPrice: 0,
      filled: false,
    },
    {
      id: "target-1",
      label: "Target 1",
      shortLabel: "T1",
      price: setup.target1,
      changeFromPrice: pct(setup.target1, price),
      filled: false,
    },
    {
      id: "target-2",
      label: "Target 2",
      shortLabel: "T2",
      price: setup.target2,
      changeFromPrice: pct(setup.target2, price),
      filled: false,
    },
    {
      id: "sl",
      label: "Invalidation (SL)",
      shortLabel: "SL",
      price: setup.stopLoss,
      changeFromPrice: pct(setup.stopLoss, price),
      filled: false,
    },
  ];

  const bullish = setup.direction === "long";
  const status = setup.status || "Limit Order";

  const zoneLabel = setup.zone.type === "demand" ? "Demand Zone" : "Supply Zone";
  const patternSummary: PatternSummary = {
    id: `${zoneLabel.toLowerCase().replace(/\s+/g, "-")}-${symbol.toLowerCase()}`,
    name: zoneLabel,
    symbol,
    confidence: setup.confidence,
    trend: bullish ? "bullish" : "bearish",
    status,
    probability: performance.totalTrades >= 3 ? performance.successRate : 0,
    riskLevel: setup.riskReward >= 2.2 ? "low" : setup.riskReward >= 1.3 ? "medium" : "high",
    timeframe,
    exchange,
    detectedAt: analyzedAt,
    shape,
  };

  return {
    pair: { symbol, base, quote, name: `${base}/${quote}`, price, change24h: ticker.priceChangePercent },
    timeframe,
    exchange,
    analyzedAt,
    chartData: { symbol, timeframe, candles },
    pattern: patternSummary,
    levels,
    riskReward: setup.riskReward,
    reasoning: buildReasoning(candles, {
      sdName: `${zoneLabel} (${setup.confidence}%)`,
      confidence: setup.confidence,
      pair: `${base}/${quote}`,
      direction: setup.direction,
      entry: setup.entry,
      target1: setup.target1,
      target2: setup.target2,
      stopLoss: setup.stopLoss,
      status,
      bias: sd.bias,
      support: sd.support,
      resistance: sd.resistance,
      zoneStrength: setup.zone.strength,
      zoneTouches: setup.zone.touches,
    }),
  };
}

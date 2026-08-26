/**
 * Perpetual-futures context: funding rate and open interest.
 *
 * Kept as pure parsers so each exchange's response shape can be asserted on
 * directly. The fetching lives in the gateway; everything here is a function
 * from a decoded JSON body to two numbers.
 *
 * Three sources rather than one because the futures APIs are the part of this
 * app most likely to be unreachable: Binance's `fapi` host answers nothing
 * from the regions the app is deployed and developed in, which is exactly how
 * both figures ended up showing an em dash on the live site.
 */

export interface DerivativesSnapshot {
  /** Funding rate as a fraction — 0.0001 is 0.01% per interval. */
  fundingRate: number;
  /** Open interest converted to US dollars. */
  openInterestUsd: number;
  /** Which exchange answered, so a stale figure can be traced. */
  source: string;
}

/** Parses to a finite number or null; empty strings and nulls both fail. */
export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Guards against a figure that is real but nonsensical.
 *
 * A funding rate is a fraction of a percent; anything past ±10% means the
 * field was a percentage, a basis-point count, or a different field entirely.
 * Open interest on BTC perps is measured in billions, and a value of zero is
 * an outage reported as a number.
 */
function plausible(fundingRate: number, openInterestUsd: number): boolean {
  return Math.abs(fundingRate) <= 0.1 && openInterestUsd > 0;
}

function snapshot(
  fundingRate: number | null,
  openInterestUsd: number | null,
  source: string,
): DerivativesSnapshot | null {
  if (fundingRate === null || openInterestUsd === null) return null;
  if (!plausible(fundingRate, openInterestUsd)) return null;
  return { fundingRate, openInterestUsd, source };
}

export interface BinancePremiumIndex {
  lastFundingRate?: unknown;
}
export interface BinanceOpenInterest {
  openInterest?: unknown;
}

/**
 * Binance USD-M futures.
 *
 * `openInterest` counts contracts, one contract being one BTC, so it needs the
 * spot price to become a dollar figure.
 */
export function parseBinanceDerivatives(
  premiumIndex: BinancePremiumIndex,
  openInterest: BinanceOpenInterest,
  btcPrice: number,
): DerivativesSnapshot | null {
  const contracts = finiteOrNull(openInterest.openInterest);
  return snapshot(
    finiteOrNull(premiumIndex.lastFundingRate),
    contracts === null || !Number.isFinite(btcPrice) ? null : contracts * btcPrice,
    "binance",
  );
}

export interface BybitTickerResponse {
  result?: { list?: Array<{ fundingRate?: unknown; openInterestValue?: unknown }> };
}

/** Bybit v5 linear tickers — reports open interest already in dollars. */
export function parseBybitDerivatives(body: BybitTickerResponse): DerivativesSnapshot | null {
  const row = body.result?.list?.[0];
  if (!row) return null;
  return snapshot(finiteOrNull(row.fundingRate), finiteOrNull(row.openInterestValue), "bybit");
}

export interface OkxFundingResponse {
  data?: Array<{ fundingRate?: unknown }>;
}
export interface OkxOpenInterestResponse {
  data?: Array<{ oiCcy?: unknown; oiUsd?: unknown }>;
}

/**
 * OKX swaps.
 *
 * `oiUsd` is preferred when present; older responses only carry `oiCcy`, the
 * count in the base asset, which the spot price converts.
 */
export function parseOkxDerivatives(
  funding: OkxFundingResponse,
  openInterest: OkxOpenInterestResponse,
  btcPrice: number,
): DerivativesSnapshot | null {
  const row = openInterest.data?.[0];
  const usd = finiteOrNull(row?.oiUsd);
  const coins = finiteOrNull(row?.oiCcy);
  const dollars =
    usd ?? (coins === null || !Number.isFinite(btcPrice) ? null : coins * btcPrice);
  return snapshot(finiteOrNull(funding.data?.[0]?.fundingRate), dollars, "okx");
}

/** `$4.2B` — the only scale open interest is ever quoted at. */
export function formatOpenInterest(usd: number): string {
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

/** `0.0100%` — four decimals, because funding is quoted in basis points. */
export function formatFundingRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

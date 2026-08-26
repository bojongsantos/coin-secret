/**
 * Symbols that have no technical setup worth showing.
 *
 * The scanner reads price action; a token whose price is pinned to something
 * else has none to read. A stablecoin quoted in USDT draws a flat line with
 * occasional noise, and the detector will happily find "zones" in that noise
 * and score them — producing confident-looking setups on a pair that cannot
 * move. Filtering them out at the source is cheaper and clearer than teaching
 * every consumer to distrust its own results.
 */

/** Bases pegged to a fiat currency. */
const STABLECOIN_BASES = new Set([
  "USDT",
  "USDC",
  "USDS",
  "USDP",
  "USDD",
  "USDE",
  "USDF",
  "USDG",
  "USD1",
  "USDX",
  "USDY",
  "BFUSD",
  "FDUSD",
  "TUSD",
  "BUSD",
  "PYUSD",
  "RLUSD",
  "FRAX",
  "LUSD",
  "GUSD",
  "SUSD",
  "XUSD",
  "DAI",
  "AEUR",
  "EURI",
  "EUR",
  "EURT",
  "USTC",
]);

/**
 * Bases that are a claim on some other asset rather than an asset themselves.
 *
 * Includes the tokenised metals (XAUT, PAXG): they are wrappers around a bar
 * of gold, so their chart is the metal's chart with a spread on top, and a
 * crypto supply/demand zone on it means nothing.
 */
const WRAPPED_BASES = new Set([
  "WBTC",
  "WETH",
  "WBETH",
  "WBNB",
  "WSOL",
  "BETH",
  "BTCB",
  "STETH",
  "WSTETH",
  "RETH",
  "CBBTC",
  "TBTC",
  "LBTC",
  "SOLVBTC",
  "XAUT",
  "PAXG",
]);

/** The base asset of a USDT pair — `HOLOUSDT` is `HOLO`. */
export function baseAsset(symbol: string): string {
  const upper = symbol.toUpperCase();
  return upper.endsWith("USDT") ? upper.slice(0, -4) : upper;
}

/**
 * Whether a symbol belongs in the scanner and the symbol search.
 *
 * Also rejects anything outside plain uppercase ASCII. Exchange boards
 * occasionally carry a listing whose display name is not its trading symbol,
 * and such an entry cannot be fetched — it only ever produces one scan error
 * per sweep, forever.
 */
export function isTradableSignalSymbol(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  if (!/^[A-Z0-9]+USDT$/.test(upper)) return false;
  const base = baseAsset(upper);
  if (base.length === 0) return false;
  if (STABLECOIN_BASES.has(base)) return false;
  if (WRAPPED_BASES.has(base)) return false;
  return true;
}

/** Applies the filter to a board, preserving order. */
export function tradableSignalSymbols(symbols: readonly string[]): string[] {
  return symbols.filter(isTradableSignalSymbol);
}

/**
 * Where a coin's logo can be found, in the order worth trying.
 *
 * Binance first: the board is made of Binance pairs, and Binance has a logo for
 * every one of them. Measured across the whole watchlist, it answered for 193
 * of 193 while the source the app used before answered for 138 — the 55 it
 * missed included PEPE, TRUMP, ORDI and IOTA, all of which showed as two grey
 * letters where a logo belonged.
 *
 * The second source stays because a single CDN is a single point of failure,
 * and a logo that fails to load is one of the few things on this product a
 * reader notices instantly.
 */
export function coinIconSources(base: string): string[] {
  const upper = base.replace(/USDT$/i, "").toUpperCase();
  const lower = upper.toLowerCase();
  if (!upper) return [];
  return [
    `https://bin.bnbstatic.com/static/assets/logos/${encodeURIComponent(upper)}.png`,
    `https://assets.coincap.io/assets/icons/${encodeURIComponent(lower)}@2x.png`,
  ];
}

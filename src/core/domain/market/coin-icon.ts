/**
 * Where a coin's logo can be found, in the order worth trying.
 *
 * Binance covers most board assets; CoinCap is the fallback. A successful
 * HTTP response does not guarantee a real logo: Binance's 1INCH PNG is a
 * black placeholder, so both the UI and result cards must skip that source.
 */
export function coinIconSources(base: string): string[] {
  const upper = base.replace(/USDT$/i, "").toUpperCase();
  const lower = upper.toLowerCase();
  if (!upper) return [];
  const coinCap = `https://assets.coincap.io/assets/icons/${encodeURIComponent(lower)}@2x.png`;
  if (upper === "1INCH") return [coinCap];
  return [
    `https://bin.bnbstatic.com/static/assets/logos/${encodeURIComponent(upper)}.png`,
    coinCap,
  ];
}

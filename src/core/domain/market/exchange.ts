/** Spot exchange whose prices define a chart or published setup. */
export type MarketExchange = "binance" | "bybit";

export function isMarketExchange(value: unknown): value is MarketExchange {
  return value === "binance" || value === "bybit";
}

export interface PlanCapability {
  /**
   * Stable name for the row, used as its React key and to look its wording up
   * in the reader's language. `label` stays the canonical text and the
   * fallback, so a row is never nameless.
   */
  id: string;
  label: string;
  /** What a free account gets: a qualifier, or a plain yes. */
  free: string | true;
  pro: string | true;
}

/**
 * The plan comparison shown on the pricing page.
 *
 * Six rows, and only the first two differ. That is the product's actual shape
 * and the table says so plainly rather than padding the Pro column: what is
 * sold is reach, not depth. A reader who cannot see the whole reasoning, the
 * confidence breakdown, the market context and the sentiment on a free account
 * has no way to judge whether the paid one is worth anything.
 */
export const PLAN_CAPABILITIES: PlanCapability[] = [
  { id: "coins", label: "Coin dan token", free: "Terbatas", pro: "Akses penuh" },
  { id: "tradingPlan", label: "Trading plan", free: "Terbatas", pro: "Akses penuh" },
  { id: "reasoning", label: "Technical analysis & reasoning", free: true, pro: true },
  { id: "confidence", label: "Confidence score", free: true, pro: true },
  { id: "marketContext", label: "Market context", free: true, pro: true },
  { id: "marketSentiment", label: "Market sentiment", free: true, pro: true },
];

/** Days of access one settled monthly payment grants. */
export const PREMIUM_PERIOD_DAYS = 30;

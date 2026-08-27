import type { SetupDirection, Timeframe } from "@/core/domain/models";

/**
 * A setup the product has already committed to showing.
 *
 * The scanner used to choose the best zone it could see on every run, which
 * meant a refresh could silently swap a live trading plan for a different one
 * — the reader watched a setup they were following disappear mid-trade, and
 * the result archive never saw how it ended. A setup that has been published
 * belongs to the reader until price finishes it.
 */
export interface ActiveSetup {
  symbol: string;
  timeframe: Timeframe;
  direction: SetupDirection;
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  confidence: number;
  zoneTop: number;
  zoneBottom: number;
  /** Open time of the bar the zone formed on. The setup's identity. */
  zoneBaseTime: number;
  status: string;
}

export interface ActiveSetupPort {
  /** Setups still in play for these symbols, at most one per symbol. */
  loadActive(symbols: string[]): Promise<ActiveSetup[]>;
  /**
   * Records new setups and status changes.
   *
   * Only what actually changed is handed over, so a steady market costs no
   * writes at all.
   */
  persist(setups: ActiveSetup[]): Promise<void>;
}

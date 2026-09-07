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

/** A zone that has already had its life, so it may not be published again. */
export interface RetiredZone {
  symbol: string;
  timeframe: Timeframe;
  direction: SetupDirection;
  zoneBaseTime: number;
}

export interface ActiveSetupPort {
  /** Setups still in play for these symbols, at most one per symbol. */
  loadActive(symbols: string[]): Promise<ActiveSetup[]>;
  /**
   * Zones these symbols have already finished, recent enough that the
   * detector can still see them.
   *
   * Without this the scan has no memory across passes: it releases a setup on
   * one run, finds the same zone on the next because the symbol is free again,
   * and publishes it back. A zone's base bar is the setup's identity, so that
   * is not a new setup — it is the old one reopened.
   */
  loadRetiredZones(symbols: string[]): Promise<RetiredZone[]>;
  /**
   * Records new setups and status changes.
   *
   * Only what actually changed is handed over, so a steady market costs no
   * writes at all.
   */
  persist(setups: ActiveSetup[]): Promise<void>;
}

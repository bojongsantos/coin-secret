/**
 * Confidence a setup must clear before the dashboard lists it.
 *
 * The detector emits a setup for every zone it can still see, including ones
 * it barely believes in — a 20% reading means "this is technically a zone",
 * not "consider this". Showing those alongside genuine setups made the list
 * long and the good entries hard to pick out, so the dashboard now carries
 * only setups the detector is more sure of than not.
 *
 * Deliberately a threshold rather than a cap on row count: filtering by rank
 * would always show something, even on a day when nothing qualifies.
 */
export const MIN_DASHBOARD_CONFIDENCE = 50;

/** Rows a plan without the full scanner is allowed to see per side. */
export const FREE_VISIBLE_SIGNALS = 3;

interface Scored {
  confidence: number;
}

/** True when a setup is confident enough for the dashboard. */
export function isDashboardSignal(hit: Scored): boolean {
  return hit.confidence > MIN_DASHBOARD_CONFIDENCE;
}

/** The subset of a scan the dashboard is allowed to show. */
export function dashboardSignals<T extends Scored>(hits: readonly T[]): T[] {
  return hits.filter(isDashboardSignal);
}

export interface SignalVisibility<T> {
  demand: T[];
  supply: T[];
  /** How many passed the filter, regardless of how many are being sent. */
  demandTotal: number;
  supplyTotal: number;
}

/**
 * What a plan may see of a scan.
 *
 * Order matters and is the whole point of this function. Filtering by
 * confidence *after* truncating to the free allowance meant the three rows a
 * free account received — the highest by volume, whatever their confidence —
 * could all fall below the floor and vanish, so the plan looked broken while
 * a premium account saw a full table from the very same scan.
 *
 * The totals count what passed the filter rather than what is being sent, so
 * the locked overlay can say how many rows are actually being withheld.
 */
export function visibleSignalsFor<T extends Scored>(
  scan: { demand: readonly T[]; supply: readonly T[] },
  fullAccess: boolean,
): SignalVisibility<T> {
  const demand = dashboardSignals(scan.demand);
  const supply = dashboardSignals(scan.supply);
  return {
    demand: fullAccess ? demand : demand.slice(0, FREE_VISIBLE_SIGNALS),
    supply: fullAccess ? supply : supply.slice(0, FREE_VISIBLE_SIGNALS),
    demandTotal: demand.length,
    supplyTotal: supply.length,
  };
}

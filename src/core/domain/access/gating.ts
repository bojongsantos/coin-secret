import type { Plan } from "@/core/domain/models";

export type FeatureKey =
  | "entryBreakdown"
  | "convictionDetail"
  | "scannerExtended"
  | "signals"
  | "symbolSearch";

export const PREMIUM_FEATURES: FeatureKey[] = ["scannerExtended", "signals", "symbolSearch"];
export const PRO_FEATURES = PREMIUM_FEATURES;

/**
 * What a free account gets in full.
 *
 * The depth of the analysis is not what is being sold. A free reader sees the
 * whole reasoning, the whole confidence breakdown, the market context and the
 * sentiment gauge; what is limited is *how many* coins and setups they can
 * reach. Someone who cannot judge the product cannot decide to pay for it.
 */
const FREE_FEATURES: FeatureKey[] = [
  "entryBreakdown",
  "convictionDetail",
];

const access: Record<Plan, Set<FeatureKey>> = {
  free: new Set(FREE_FEATURES),
  premium: new Set([...FREE_FEATURES, ...PREMIUM_FEATURES]),
};

export function hasFeature(plan: Plan, feature: FeatureKey, override?: boolean): boolean {
  if (override !== undefined) return override;
  return access[plan].has(feature);
}

export const featureLabel: Record<FeatureKey, string> = {
  entryBreakdown: "Entry, targets & invalidation levels",
  convictionDetail: "Confidence score breakdown",
  scannerExtended: "Full scanner opportunities list",
  signals: "Signals: live supply and demand setups across the whole board",
  symbolSearch: "Search any coin on the board",
};

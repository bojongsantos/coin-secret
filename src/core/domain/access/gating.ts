import type { Plan } from "@/core/domain/models";

export type FeatureKey =
  | "entryBreakdown"
  | "convictionDetail"
  | "scannerExtended"
  | "signals";

export const PREMIUM_FEATURES: FeatureKey[] = ["scannerExtended", "signals"];
export const PRO_FEATURES = PREMIUM_FEATURES;

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
};

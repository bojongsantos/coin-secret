import { hasFeature, type FeatureKey } from "@/core/domain/access/gating";

export interface PlanCapability {
  label: string;
  /** A quantity ("20 simbol") or a plain yes/no. */
  free: string | boolean;
  premium: string | boolean;
  hint?: string;
}

/**
 * Buyer-facing wording. `featureLabel` names each feature as it appears inside
 * the product and stays in English there; a pricing table aimed at Indonesian
 * readers should not mix the two languages mid-sentence.
 */
const CAPABILITY_LABEL: Record<FeatureKey, string> = {
  entryBreakdown: "Level entry, target, dan invalidasi",
  convictionDetail: "Rincian confidence score",
  scannerExtended: "Daftar peluang scanner penuh",
  signals: "Signals — setup supply & demand di seluruh watchlist",
};

/** Yes/no values come from the same gate the server enforces. */
function forFeature(feature: FeatureKey): PlanCapability {
  return {
    label: CAPABILITY_LABEL[feature],
    free: hasFeature("free", feature),
    premium: hasFeature("premium", feature),
  };
}

/**
 * The plan comparison shown on the pricing page.
 *
 * Every quantity is read from the same constant the server enforces, so the
 * table cannot drift into advertising a limit the product does not actually
 * grant.
 */
export const PLAN_CAPABILITIES: PlanCapability[] = [
  forFeature("entryBreakdown"),
  forFeature("convictionDetail"),
  forFeature("scannerExtended"),
  forFeature("signals"),
  {
    label: "Chart lifetime pada semua interval",
    free: true,
    premium: true,
    hint: "Interval dan rentang histori terpisah; ALL tersedia di semua interval.",
  },
];

/** Days of access one Premium payment grants. */
export const PREMIUM_PERIOD_DAYS = 30;

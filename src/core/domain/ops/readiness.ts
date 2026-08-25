import { DEFAULT_PAYMENT_PROVIDER } from "@/core/domain/billing/providers";

export type ReadinessLevel = "ready" | "blocked";

export interface CapabilityReport {
  id: string;
  name: string;
  level: ReadinessLevel;
  /** Environment variables this capability cannot work without. */
  requires: string[];
  /** The ones that are absent. Empty when ready. */
  missing: string[];
  /** What stops working for users while it is missing. */
  impact: string;
}

interface Capability {
  id: string;
  name: string;
  requires: string[];
  impact: string;
}

/**
 * Variables each payment provider cannot charge without.
 *
 * Kept as data rather than read from the adapters so this module stays in the
 * domain, and so a report can be produced for a provider this deployment is
 * not currently using.
 */
const PAYMENT_PROVIDER_KEYS: Record<string, string[]> = {
  midtrans: ["MIDTRANS_SERVER_KEY"],
  nowpayments: ["NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"],
};



/**
 * Capabilities that depend on configuration rather than on code.
 *
 * Each entry names the variables it cannot work without and, more usefully,
 * what a user loses while they are absent. A missing key never announces
 * itself: the deployment builds, the pages render, and only the person who
 * tries to pay or reset a password ever finds out.
 */
const CAPABILITIES: Capability[] = [
  {
    id: "database",
    name: "Database",
    requires: ["DATABASE_URL"],
    impact: "Login, watchlist, alert, dan pembayaran seluruhnya berhenti.",
  },
  {
    id: "auth",
    name: "Autentikasi",
    requires: ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"],
    impact: "Pengguna tidak dapat masuk atau mendaftar.",
  },
  {
    id: "email",
    name: "Email transaksional",
    requires: ["BREVO_API_KEY", "EMAIL_FROM"],
    impact: "Reset password gagal, dan verifikasi email tidak pernah terkirim.",
  },
  {
    id: "alerts",
    name: "Sweep terjadwal",
    requires: ["CRON_SECRET"],
    impact: "Endpoint cron membalas 503, sehingga arsip bukti hasil setup tidak pernah terisi.",
  },
];

/**
 * Reports which configured capabilities are actually usable.
 *
 * Takes the set of variable names that hold a non-empty value, never the
 * values themselves, so a report can be produced and logged without carrying
 * secrets along with it.
 */
export function assessReadiness(
  presentKeys: Iterable<string>,
  paymentProvider: string = DEFAULT_PAYMENT_PROVIDER,
): CapabilityReport[] {
  const present = new Set(presentKeys);
  // An unrecognised provider has no key list to check, so nothing would ever
  // report as missing. Naming the variable itself keeps the report honest
  // about a deployment that cannot charge at all.
  const paymentKeys = PAYMENT_PROVIDER_KEYS[paymentProvider] ?? ["PAYMENT_PROVIDER"];
  const capabilities: Capability[] = [
    ...CAPABILITIES,
    {
      id: "payments",
      name: `Pembayaran (${paymentProvider})`,
      requires: paymentKeys,
      impact: "Checkout membalas 503 dan tidak ada yang dapat membeli Premium.",
    },
  ];
  return capabilities.map((capability) => {
    const missing = capability.requires.filter((key) => !present.has(key));
    return {
      id: capability.id,
      name: capability.name,
      level: missing.length === 0 ? "ready" : "blocked",
      requires: capability.requires,
      missing,
      impact: capability.impact,
    };
  });
}

/** True when every capability has what it needs. */
export function isFullyConfigured(reports: readonly CapabilityReport[]): boolean {
  return reports.every((report) => report.level === "ready");
}

/** Names of the variables that must be supplied before the app is complete. */
export function missingKeys(reports: readonly CapabilityReport[]): string[] {
  return [...new Set(reports.flatMap((report) => report.missing))];
}

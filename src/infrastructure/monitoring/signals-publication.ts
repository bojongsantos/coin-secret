import "server-only";
import { parseSignalsSnapshot } from "@/core/application/scanner/published-board-service";
import { signalsSnapshotStore } from "@/infrastructure/persistence/signals-snapshot-store";
import { marketData } from "@/infrastructure/market-data/market-data-provider";

export interface SignalsPublication {
  status: "fresh" | "stale" | "overdue" | "expired" | "invalid" | "missing" | "unavailable" | "in-progress";
  durable: boolean;
  verified: boolean;
  scannedAt: string | null;
  checkedAt: string;
  ageSeconds: number | null;
}

/** Observe the actual durable board; memory success is not a publication proof. */
export async function readSignalsPublication(minimumScannedAt?: string): Promise<SignalsPublication> {
  const now = Date.now();
  const base: SignalsPublication = { status: "unavailable", durable: false, verified: false,
    scannedAt: null, checkedAt: new Date(now).toISOString(), ageSeconds: null };
  try {
    const value = await signalsSnapshotStore.load(AbortSignal.timeout(25_000));
    if (value === null || value === undefined) return { ...base, status: "missing" };
    const snapshot = parseSignalsSnapshot(value, marketData);
    if (!snapshot) return { ...base, status: "invalid" };
    const scanned = Date.parse(snapshot.result.scannedAt);
    const age = Date.now() - scanned;
    if (age < 0) return { ...base, status: "invalid" };
    const status = age > 3_600_000 ? "expired" : age > 2_700_000 ? "overdue" : age >= 60_000 ? "stale" : "fresh";
    const minimum = minimumScannedAt === undefined ? scanned : Date.parse(minimumScannedAt);
    return { ...base, status, durable: true,
      verified: age <= 2_700_000 && Number.isFinite(minimum) && scanned >= minimum,
      scannedAt: snapshot.result.scannedAt, ageSeconds: Math.floor(age / 1000) };
  } catch {
    console.warn("[signals.publication]", { operation: "read", status: "unavailable" });
    return base;
  }
}

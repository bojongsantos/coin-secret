import "server-only";

import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { rankTopSetups, runSdScanCached } from "@/core/application/scanner/supply-demand-scan-service";
import { visibleSignalsFor } from "@/core/domain/analysis/signal-display";
import { activeSetupStore } from "@/infrastructure/persistence/active-setup-store";
import { marketData } from "@/infrastructure/market-data/market-data-provider";

/** One live scan supplies both dashboard tables and the moving top-20 strip. */
export async function getDashboardSignals(fullAccess: boolean, force = false) {
  const scanned = await runSdScanCached(
    marketData,
    DEFAULT_WATCHLIST,
    force,
    { activeSetups: activeSetupStore },
  );
  return {
    result: { ...scanned, ...visibleSignalsFor(scanned, fullAccess) },
    top: rankTopSetups(scanned, 20),
  };
}

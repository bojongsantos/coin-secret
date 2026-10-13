import type { MarketExchange } from "@/core/domain/market/exchange";
import type { SdScanResult } from "@/core/application/scanner/supply-demand-scan-service";
import type { ActiveSetupPort } from "@/core/application/ports/active-setup-port";

export interface SignalsSnapshot {
  version: 1;
  symbols: string[];
  sources: (MarketExchange | null)[];
  result: SdScanResult;
}

/** Only the completed public market board is stored, never a user's access. */
export interface SignalsSnapshotPort {
  load(signal?: AbortSignal): Promise<unknown>;
  save(snapshot: SignalsSnapshot): Promise<void>;
  /** A fenced transaction owns all setup writes until the scan commits. */
  coordinateRefresh?<T>(work: (activeSetups: ActiveSetupPort) => Promise<T>): Promise<
    { acquired: true; value: T } | { acquired: false }
  >;
}

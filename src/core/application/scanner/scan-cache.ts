import type { ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";

interface ScanIdentity {
  marketData: MarketDataPort;
  activeSetups?: ActiveSetupPort;
  symbols: string;
}

function sameScan(a: ScanIdentity, b: ScanIdentity): boolean {
  return a.marketData === b.marketData && a.activeSetups === b.activeSetups && a.symbols === b.symbols;
}

/** Keeps one completed board, while every distinct pending scan stays discoverable. */
export function createScanCache<Result>(ttlMs: number) {
  let cached: { identity: ScanIdentity; timestamp: number; result: Result } | undefined;
  const pending = new Map<Promise<Result>, ScanIdentity>();

  return (
    marketData: MarketDataPort,
    symbols: string[],
    force: boolean,
    activeSetups: ActiveSetupPort | undefined,
    scan: () => Promise<Result>,
  ): Promise<Result> => {
    const identity = { marketData, activeSetups, symbols: JSON.stringify(symbols) };
    // A forced refresh skips completed data, but joins work already refreshing
    // this board. Ordinary reads also wait for it instead of serving the old board.
    for (const [promise, running] of pending) {
      if (sameScan(running, identity)) return promise;
    }
    if (!force && cached && sameScan(cached.identity, identity) && Date.now() - cached.timestamp < ttlMs) {
      return Promise.resolve(cached.result);
    }
    if (cached && sameScan(cached.identity, identity)) cached = undefined;

    const promise = scan()
      .then((result) => {
        cached = { identity, timestamp: Date.now(), result };
        return result;
      })
      .finally(() => {
        pending.delete(promise);
      });
    pending.set(promise, identity);
    return promise;
  };
}

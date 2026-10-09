import type { MarketDataPort } from "@/core/application/ports/market-data-port";

export interface FailoverOptions {
  /** How long a provider is benched after it fails, in milliseconds. */
  cooldownMs?: number;
  /** Injectable clock so the bench logic stays testable. */
  now?: () => number;
}

const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * A caller-initiated abort must never trigger a failover: the user navigated
 * away or switched symbol, so every provider would be cancelled too. A request
 * timeout is different — it means this provider is slow or blocked, and the
 * next one deserves a turn.
 */
function abortedByCaller(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Wraps several market-data providers into one that transparently falls back
 * to the next provider when the current one fails. A failing provider is
 * benched for `cooldownMs` so a dead primary is not retried on every call,
 * and is restored the moment it answers correctly again.
 */
export function createFailoverMarketData(
  providers: readonly MarketDataPort[],
  options: FailoverOptions = {},
): MarketDataPort {
  if (providers.length === 0) {
    throw new Error("Failover market data requires at least one provider");
  }
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = options.now ?? Date.now;
  const benchedUntil = new Map<number, number>();

  /** Healthy providers first, each group keeping its configured priority. */
  function attemptOrder(): number[] {
    const time = now();
    return providers
      .map((_, index) => index)
      .sort((a, b) => {
        const aBenched = (benchedUntil.get(a) ?? 0) > time ? 1 : 0;
        const bBenched = (benchedUntil.get(b) ?? 0) > time ? 1 : 0;
        return aBenched !== bBenched ? aBenched - bBenched : a - b;
      });
  }

  async function run<T>(
    operation: (provider: MarketDataPort) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown;
    for (const index of attemptOrder()) {
      if (abortedByCaller(signal)) {
        throw signal?.reason ?? new DOMException("Aborted", "AbortError");
      }
      try {
        const value = await operation(providers[index]);
        benchedUntil.delete(index);
        return value;
      } catch (error) {
        if (abortedByCaller(signal)) throw error;
        benchedUntil.set(index, now() + cooldownMs);
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Every market data provider failed");
  }

  return {
    fetchKlines: (query) => run((provider) => provider.fetchKlines(query), query.signal),
    fetchTicker24h: (symbol, signal) =>
      run((provider) => provider.fetchTicker24h(symbol, signal), signal),
    fetchTickers24h: (symbols, signal) => run((provider) => provider.fetchTickers24h(symbols, signal), signal),
  };
}

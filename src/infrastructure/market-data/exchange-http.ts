const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_DELAYS_MS = [250, 750];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(id);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Shared JSON fetch for public exchange endpoints: per-attempt timeout, retries
 * on rate limiting and server faults, and immediate surrender on a client error
 * that a retry cannot fix.
 */
export async function requestExchangeJson<T>(
  baseUrl: string,
  path: string,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let retryable = true;
    try {
      const res = await fetch(`${baseUrl}${path}`, { cache: "no-store", signal: combined });
      if (!res.ok) {
        const error = new Error(`${label} API ${res.status}: ${res.statusText}`);
        retryable = res.status === 429 || res.status >= 500;
        if (!retryable) throw error;
        lastError = error;
      } else {
        return (await res.json()) as T;
      }
    } catch (error) {
      if (signal?.aborted || !retryable) throw error;
      lastError = error;
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt], signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} request failed`);
}

/** Parses an exchange numeric field, rejecting NaN/Infinity so bad data never reaches the chart. */
export function exchangeNumber(value: unknown, field: string, label: string): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label} field: ${field}`);
  return parsed;
}

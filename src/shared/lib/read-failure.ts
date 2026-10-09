export class ReadFailure extends Error {
  constructor(message: string, readonly retryable = true, readonly retryAfterMs = 0) {
    super(message);
    this.name = "ReadFailure";
  }
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

export function responseReadFailure(status: number, label: string, retryAfter: string | null): ReadFailure {
  if (status === 401) return new ReadFailure("Your session expired. Sign in and refresh.", false);
  if (status === 403) return new ReadFailure("Your access changed. Refresh to update available data.", false);
  if (status === 429) return new ReadFailure("Too many requests. Please wait before refreshing.", true, retryAfterMs(retryAfter) || 60_000);
  return new ReadFailure(`${label} is temporarily unavailable. Please refresh.`, status >= 500 || status === 408);
}

export function normalizeReadFailure(caught: unknown, label: string): ReadFailure {
  if (caught instanceof ReadFailure) return caught;
  if (caught instanceof Error && caught.name === "TimeoutError") {
    return new ReadFailure(`${label} request timed out. Please refresh.`);
  }
  if (caught instanceof Error && caught.name === "SyntaxError") {
    return new ReadFailure(`${label} returned an unreadable response. Please refresh.`);
  }
  return new ReadFailure(`Unable to load ${label.toLowerCase()}. Check your connection and refresh.`);
}

/** Three quick recovery attempts, then the normal polling cadence. */
export function readRetryDelay(failures: number, refreshMs: number, retryAfter = 0): number {
  return Math.max(retryAfter, failures <= 3 ? Math.min(refreshMs, 2000 * 2 ** (failures - 1)) : refreshMs);
}

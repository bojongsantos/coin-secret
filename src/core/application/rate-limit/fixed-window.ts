export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the window resets. Zero when the request was allowed. */
  retryAfterSeconds: number;
}

export interface FixedWindowOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Cap on tracked keys, so the counter map cannot grow without bound. */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

/**
 * Fixed-window counter used to bound expensive endpoints per client.
 *
 * Deliberately in-process: it needs no database round trip on the hot path.
 * With several server instances each holds its own window, so treat the
 * effective limit as per-instance rather than global — enough to remove the
 * amplification primitive, not a billing-grade quota.
 */
export function createFixedWindowLimiter(options: FixedWindowOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const windows = new Map<string, { count: number; resetAt: number }>();

  function evictExpired(current: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt <= current) windows.delete(key);
    }
  }

  return {
    check(key: string): RateLimitDecision {
      const current = now();
      const existing = windows.get(key);

      if (!existing || existing.resetAt <= current) {
        // Only sweep when the map is under pressure; a per-request scan would
        // make the limiter itself the expensive part.
        if (windows.size >= maxKeys) evictExpired(current);
        if (windows.size >= maxKeys) {
          return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(options.windowMs / 1_000)) };
        }
        windows.set(key, { count: 1, resetAt: current + options.windowMs });
        return { allowed: true, remaining: Math.max(0, options.limit - 1), retryAfterSeconds: 0 };
      }

      if (existing.count >= options.limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - current) / 1_000)),
        };
      }

      existing.count++;
      return {
        allowed: true,
        remaining: Math.max(0, options.limit - existing.count),
        retryAfterSeconds: 0,
      };
    },
  };
}

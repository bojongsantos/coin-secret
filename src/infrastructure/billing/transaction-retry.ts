// Pure control flow on purpose: no "server-only" import here, so the unit
// tests can exercise this helper under plain tsx like the rest of the tree.

/** The code Prisma reports when a Serializable transaction loses a race. */
const SERIALIZATION_CONFLICT_CODE = "P2034";

/** Attempts allowed before a conflict is treated as unretryable. */
const MAX_ATTEMPTS = 3;

/** Whether a thrown value is a serialization conflict rather than a real fault. */
export function isSerializationConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === SERIALIZATION_CONFLICT_CODE
  );
}

/**
 * Bounded retry for Serializable transaction conflicts.
 *
 * Concurrent callbacks for the same order can make PostgreSQL abort one of
 * them, which Prisma surfaces as P2034. Retrying the whole operation — not the
 * single write that lost — makes every attempt re-read the payment row it
 * decides from, so a stale snapshot can never drive a grant or a revoke.
 *
 * Only conflicts are retried. Every other error is rethrown on the first
 * attempt, and an exhausted budget is rethrown unchanged so the caller can
 * still recognise the failure and answer with a retryable status instead of
 * acknowledging the callback as applied.
 */
export async function withSerializationRetry<T>(
  work: () => Promise<T>,
  attempts: number = MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= attempts || !isSerializationConflict(error)) throw error;
    }
  }
}

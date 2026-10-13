import "server-only";

import { setTimeout as delay } from "node:timers/promises";
import { HttpError } from "@/shared/server/http";

type SetupRead = "active" | "retired" | "snapshot";

function connectionFailure(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = "code" in error ? error.code : undefined;
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "08000", "08001", "08003", "08006", "57P01", "P1001", "P1017"].includes(String(code))) {
    return "connection-lost";
  }
  // Native pg connect/checkout errors have no code, including when Prisma
  // preserves them. Match only known driver text, never arbitrary timeouts.
  if (code !== undefined) return null;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  if (message.includes("Connection terminated due to connection timeout")) return "connect-timeout";
  if (message.includes("timeout exceeded when trying to connect")) return "pool-timeout";
  if (["Connection terminated unexpectedly", "Client has encountered a connection error and is not queryable", "Client was closed and is not queryable"].some((text) => message.includes(text))) {
    return "connection-lost";
  }
  return null;
}

function failureCategory(error: unknown): string {
  if (typeof error !== "object" || error === null) return "query-error";
  // PrismaPg preserves server SQLSTATE in this adapter-specific cause. Read
  // only known fields; neither the cause nor its message is emitted to logs.
  const details = error as {
    code?: unknown; message?: unknown; name?: unknown;
    meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown; originalMessage?: unknown } } };
  };
  const cause = details.meta?.driverAdapterError?.cause;
  if (cause?.kind === "SocketTimeout") return "socket-timeout";
  if (cause?.kind === "DatabaseNotReachable") return "connection-unreachable";
  if (cause?.kind === "TlsConnectionError") return "tls-connection";
  const code = cause?.originalCode ?? details.code;
  const message = typeof cause?.originalMessage === "string" ? cause.originalMessage
    : typeof details.message === "string" ? details.message : "";
  const connection = connectionFailure({ code, message });
  if (connection) return connection;
  if (code === "57014") return message.includes("canceling statement due to statement timeout") ? "statement-timeout" : "query-cancelled";
  if (code === "55P03") return message.includes("canceling statement due to lock timeout") ? "lock-timeout" : "lock-unavailable";
  if (code === "53300" || code === "P2037") return "connection-capacity";
  if (details.name === "TimeoutError") return "read-deadline";
  if (details.name === "AbortError") return "read-aborted";
  return "query-error";
}

/** Only standalone public market SELECTs: never transactions, auth, or payment work. */
export async function readSetupRows<T>(read: SetupRead, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const startedAt = performance.now();
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    const attemptStartedAt = performance.now();
    try {
      const rows = await work();
      signal?.throwIfAborted();
      return rows;
    } catch (error) {
      const aborted = signal?.aborted === true;
      const retrying = !aborted && attempt === 1 && connectionFailure(error) !== null;
      const completedAt = performance.now();
      // Do not log Prisma exceptions: their messages can contain SQL/values.
      console.warn("[database.setup-read]", {
        read, category: failureCategory(error), attempt, retrying, aborted,
        elapsedMs: Math.max(0, Math.round(completedAt - startedAt)),
        attemptElapsedMs: Math.max(0, Math.round(completedAt - attemptStartedAt)),
      });
      // Preserve the observed native error category even if the read deadline
      // expired while waiting for that real SELECT to settle.
      signal?.throwIfAborted();
      if (!retrying) {
        throw new HttpError(503, "Published setups are temporarily unavailable. Please retry.", "SETUP_STORE_UNAVAILABLE");
      }
      await delay(200, undefined, { signal });
    }
  }
}

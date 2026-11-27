import "server-only";

import { setTimeout as delay } from "node:timers/promises";
import { HttpError } from "@/shared/server/http";

type SetupRead = "active" | "retired" | "snapshot";

function nativeError(error: unknown): { code: unknown; message: string; kind: unknown; name: unknown } {
  if (typeof error !== "object" || error === null) return { code: undefined, message: "", kind: undefined, name: undefined };
  const details = error as { code?: unknown; errno?: unknown; message?: unknown; name?: unknown;
    meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown; originalMessage?: unknown } } } };
  const cause = details.meta?.driverAdapterError?.cause;
  return {
    code: cause?.originalCode ?? details.errno ?? details.code,
    message: typeof cause?.originalMessage === "string" ? cause.originalMessage : typeof details.message === "string" ? details.message : "",
    kind: cause?.kind,
    name: details.name,
  };
}

function connectionFailure(error: unknown): string | null {
  const { code, message } = nativeError(error);
  if (["45012", "ER_CONNECTION_TIMEOUT"].includes(String(code))) return "connect-timeout";
  if (["45028", "ER_GET_CONNECTION_TIMEOUT"].includes(String(code))) return "pool-timeout";
  if (["45026", "ER_SOCKET_TIMEOUT"].includes(String(code))) return "response-timeout";
  if (["45001", "45004", "45009", "45013", "2006", "2013", "1053"].includes(String(code))) return "connection-lost";
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "08000", "08001", "08003", "08006", "57P01", "P1001", "P1017"].includes(String(code))) {
    return "connection-lost";
  }
  // Retain exact legacy connection messages during the database cutover.
  if (code !== undefined) return null;
  if (message === "Query read timeout") return "response-timeout";
  if (message.includes("Connection terminated due to connection timeout")) return "connect-timeout";
  if (message.includes("timeout exceeded when trying to connect")) return "pool-timeout";
  if (["Connection terminated unexpectedly", "Client has encountered a connection error and is not queryable", "Client was closed and is not queryable"].some((text) => message.includes(text))) {
    return "connection-lost";
  }
  return null;
}

function failureCategory(error: unknown): string {
  const { code, message, kind, name } = nativeError(error);
  if (kind === "SocketTimeout") return "socket-timeout";
  if (kind === "DatabaseNotReachable") return "connection-unreachable";
  if (kind === "TlsConnectionError" || ["45008", "45023", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(String(code))) return "tls-connection";
  const connection = connectionFailure(error);
  if (connection) return connection;
  if (String(code) === "1969") return "statement-timeout";
  if (String(code) === "1317") return "query-cancelled";
  if (String(code) === "1205") return "lock-timeout";
  if (String(code) === "3572") return "lock-unavailable";
  if (["1040", "1203"].includes(String(code))) return "connection-capacity";
  if (code === "57014") return message.includes("canceling statement due to statement timeout") ? "statement-timeout" : "query-cancelled";
  if (code === "55P03") return message.includes("canceling statement due to lock timeout") ? "lock-timeout" : "lock-unavailable";
  if (code === "53300" || code === "P2037") return "connection-capacity";
  if (name === "TimeoutError") return "read-deadline";
  if (name === "AbortError") return "read-aborted";
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

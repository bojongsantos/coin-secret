import "server-only";
import { HttpError } from "@/shared/server/http";

export const PAYMENT_REQUEST_TIMEOUT_MS = 10_000;

/** No retry on invoice creation: an unanswered POST may already have succeeded. */
export async function paymentJson(url: string, init: RequestInit): Promise<{
  ok: boolean; status: number; data: unknown;
}> {
  try {
    const response = await fetch(url, {
      ...init, cache: "no-store", signal: AbortSignal.timeout(PAYMENT_REQUEST_TIMEOUT_MS),
    });
    const data: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch {
    throw new HttpError(502, "Status permintaan pembayaran belum dapat dipastikan. Jangan membuat pembayaran ulang sebelum diperiksa.", "PAYMENT_GATEWAY_UNCERTAIN");
  }
}

export function checkoutFailure(status: number): HttpError {
  const rejected = status >= 400 && status < 500 && status !== 408 && status !== 409;
  return new HttpError(502,
    rejected ? "Gateway menolak permintaan pembayaran." : "Status permintaan pembayaran belum dapat dipastikan. Hubungi dukungan sebelum mencoba kembali.",
    rejected ? "PAYMENT_GATEWAY_REJECTED" : "PAYMENT_GATEWAY_UNCERTAIN");
}

export function safeCheckoutUrl(value: unknown, hosts: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && hosts.includes(url.hostname)
      ? url.toString() : null;
  } catch { return null; }
}

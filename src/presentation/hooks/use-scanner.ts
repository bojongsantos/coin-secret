"use client";

import { useCallback } from "react";
import type { ScanResult } from "@/core/application/scanner/scanner-service";
import type { SdScanResult, TopSetup } from "@/core/application/scanner/supply-demand-scan-service";
import { AUTH_STATE_CHANGED_EVENT } from "@/infrastructure/auth/auth-client";
import { usePlan } from "@/presentation/features/access/plan-provider";
import { usePollingRead } from "@/presentation/hooks/use-polling-read";
import { ReadFailure, responseReadFailure } from "@/shared/lib/read-failure";

export interface SignalsApiPayload {
  result: SdScanResult;
  top: TopSetup[];
}

const SCAN_REFRESH_MS = 60_000;
// A cold scan can read the complete universe. Bound the client wait while
// allowing that normal work substantially more time than a cached response.
const SCAN_REQUEST_MS = 90_000;

function scanUpdatedAt(data: ScanResult | SignalsApiPayload): string {
  return "result" in data ? data.result.scannedAt : data.scannedAt;
}

async function postScan<T extends ScanResult | SignalsApiPayload>(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const label = path === "/api/scanner" ? "Scanner" : "Signals";
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(SCAN_REQUEST_MS)]),
  });
  if (!response.ok) throw responseReadFailure(response.status, label, response.headers.get("retry-after"));
  const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  const result = path === "/api/scanner" ? payload : payload?.result;
  const valid = result && typeof result.scannedAt === "string" && Number.isFinite(Date.parse(result.scannedAt)) && Array.isArray(result.errors) &&
    (path === "/api/scanner"
      ? Array.isArray(result.opportunities) && Number.isFinite(result.total)
      : Array.isArray(result.demand) && Array.isArray(result.supply) && Array.isArray(payload.top) &&
        Number.isFinite(result.demandTotal) && Number.isFinite(result.supplyTotal));
  if (!valid) throw new ReadFailure(`${label} returned an unreadable response. Please refresh.`);
  return payload as T;
}

/** Every scan view shares bounded, single-flight polling and unmount cancellation. */
function usePollingScan<T extends ScanResult | SignalsApiPayload>(path: string, enabled = true, limit?: number) {
  const { authenticated, plan, canAccess } = usePlan();
  const accessKey = `${authenticated}:${plan}:${canAccess(path === "/api/scanner" ? "scannerExtended" : "signals")}`;
  const read = useCallback((force: boolean, signal: AbortSignal) =>
    postScan<T>(path, { force, ...(limit === undefined ? {} : { limit }) }, signal), [path, limit]);
  return usePollingRead<T>({
    enabled, accessKey, invalidateEvent: AUTH_STATE_CHANGED_EVENT,
    label: path === "/api/scanner" ? "Scanner" : "Signals", refreshMs: SCAN_REFRESH_MS,
    read, updatedAt: scanUpdatedAt,
  });
}

/** The dashboard reads one response for its tables and five top setups. */
export function useDashboardSignals() {
  const { data, loading, error, lastUpdated, stale, refresh } = usePollingScan<SignalsApiPayload>("/api/signals", true, 5);
  return {
    result: data?.result ?? null,
    top: data?.top ?? [],
    loading, error, lastUpdated, stale, refresh,
    failedCount: data?.result.errors.length ?? 0,
  };
}

export function useScanner() {
  const { data, loading, error, lastUpdated, stale, refresh } = usePollingScan<ScanResult>("/api/scanner");
  return {
    opportunities: data?.opportunities ?? [],
    total: data?.total ?? 0,
    loading,
    error: error ?? (data?.errors.length ? `${data.errors.length} symbols could not be updated. Please refresh.` : null),
    lastRun: data?.scannedAt ?? null,
    lastUpdated, stale, refresh,
  };
}

export function useSdScan(enabled = true) {
  const { data, loading, error, lastUpdated, stale, refresh } = usePollingScan<SignalsApiPayload>("/api/signals", enabled);
  return {
    result: data?.result ?? null,
    loading, error, lastUpdated, stale, refresh,
    failedCount: data?.result.errors.length ?? 0,
    lastRun: data?.result.scannedAt ?? null,
  };
}

export function useTopSetups(limit = 5) {
  const { data, loading, error, lastUpdated, stale, refresh } = usePollingScan<SignalsApiPayload>("/api/signals", true, limit);
  return { top: data?.top ?? [], loading, error, lastUpdated, stale, refresh };
}

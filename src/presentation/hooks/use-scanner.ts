"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanResult } from "@/core/application/scanner/scanner-service";
import type { SdScanResult, TopSetup } from "@/core/application/scanner/supply-demand-scan-service";
import type { ScannerOpportunity } from "@/core/domain/models";

export interface SignalsApiPayload {
  result: SdScanResult;
  top: TopSetup[];
}

const SCAN_REFRESH_MS = 60_000;
// A cold scan can read the complete universe. Bound the client wait while
// allowing that normal work substantially more time than a cached response.
const SCAN_REQUEST_MS = 90_000;

async function postScan<T>(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(SCAN_REQUEST_MS)]),
  });
  const payload = response.headers.get("content-type")?.includes("application/json")
    ? (await response.json()) as T & { error?: string }
    : null;
  if (!payload) throw new Error(`Signals temporarily unavailable (${response.status}). Try refreshing.`);
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

/** Every scan view shares bounded, single-flight polling and unmount cancellation. */
function usePollingScan<T>(path: string, enabled = true, limit?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  const execute = useCallback(async (force: boolean) => {
    if (!enabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const payload = await postScan<T>(path, { force, ...(limit === undefined ? {} : { limit }) }, controller.signal);
      if (controller.signal.aborted) return;
      setData(payload);
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted) return;
      // A failed refresh must not leave an old setup presented as current.
      setData(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [path, enabled, limit]);

  useEffect(() => {
    if (!enabled) return;
    const kickoff = window.setTimeout(() => void execute(false), 0);
    const poll = window.setInterval(() => void execute(false), SCAN_REFRESH_MS);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(poll);
      request.current?.abort();
      request.current = null;
    };
  }, [execute, enabled]);

  return { data, loading: enabled && loading, error, refresh: useCallback(() => void execute(true), [execute]) };
}

/** The dashboard reads one response for its tables and five top setups. */
export function useDashboardSignals() {
  const { data, loading, error, refresh } = usePollingScan<SignalsApiPayload>("/api/signals", true, 5);
  return {
    result: data?.result ?? null,
    top: data?.top ?? [],
    loading, error, refresh,
    failedCount: data?.result.errors.length ?? 0,
  };
}

export function useScanner(): {
  opportunities: ScannerOpportunity[];
  total: number;
  loading: boolean;
  error: string | null;
  lastRun: string | null;
  refresh: () => void;
} {
  const { data, loading, error, refresh } = usePollingScan<ScanResult>("/api/scanner");
  return {
    opportunities: data?.opportunities ?? [],
    total: data?.total ?? 0,
    loading,
    error: error ?? (data?.errors.length ? data.errors.join("; ") : null),
    lastRun: data?.scannedAt ?? null,
    refresh,
  };
}

export function useSdScan(enabled = true): {
  result: SdScanResult | null;
  loading: boolean;
  error: string | null;
  failedCount: number;
  lastRun: string | null;
  refresh: () => void;
} {
  const { data, loading, error, refresh } = usePollingScan<SignalsApiPayload>("/api/signals", enabled);
  return {
    result: data?.result ?? null,
    loading, error, refresh,
    failedCount: data?.result.errors.length ?? 0,
    lastRun: data?.result.scannedAt ?? null,
  };
}

export function useTopSetups(limit = 5): {
  top: TopSetup[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { data, loading, error, refresh } = usePollingScan<SignalsApiPayload>("/api/signals", true, limit);
  return { top: data?.top ?? [], loading, error, refresh };
}

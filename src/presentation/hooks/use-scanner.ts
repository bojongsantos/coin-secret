"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanResult } from "@/core/application/scanner/scanner-service";
import type {
  SdScanResult,
  TopSetup,
} from "@/core/application/scanner/supply-demand-scan-service";
import type { ScannerOpportunity } from "@/core/domain/models";

export interface SignalsApiPayload {
  result: SdScanResult;
  top: TopSetup[];
}

/** The dashboard reads one response for its tables and top setups. */
export function useDashboardSignals() {
  const [payload, setPayload] = useState<SignalsApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const execute = useCallback(async (force: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setPayload(await postScan<SignalsApiPayload>("/api/signals", { force, limit: 5 }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void execute(false), 0);
    const poll = window.setInterval(() => void execute(false), SCAN_REFRESH_MS);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(poll);
    };
  }, [execute]);

  return {
    result: payload?.result ?? null,
    top: payload?.top ?? [],
    loading,
    error,
    failedCount: payload?.result.errors.length ?? 0,
    refresh: () => void execute(true),
  };
}

/**
 * How often the scan lists re-read the market.
 *
 * Matches the server's own cache window, so a refresh is nearly free while the
 * screen stays truthful. Fetching once on mount left the tables and the top-5
 * strip frozen at the moment the page opened while the chart beside them kept
 * streaming — click a setup listed minutes ago and the chart, correctly, shows
 * nothing there any more.
 */
const SCAN_REFRESH_MS = 60_000;

/**
 * Posts a scan request.
 *
 * No symbol list travels with it any more: the browser used to send the user's
 * saved watchlist, and with that gone every caller gets the server's default
 * universe — which is also the only way the scan cache can be shared.
 */
async function postScan<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = response.headers.get("content-type")?.includes("application/json")
    ? (await response.json()) as T & { error?: string }
    : null;
  if (!payload) throw new Error(`Signals sementara tidak tersedia (${response.status}). Coba refresh.`);
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

export function useScanner(): {
  opportunities: ScannerOpportunity[];
  total: number;
  loading: boolean;
  error: string | null;
  lastRun: string | null;
  refresh: () => void;
} {
  const [opportunities, setOpportunities] = useState<ScannerOpportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const execute = useCallback(async (force: boolean) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const result = await postScan<ScanResult>("/api/scanner", { force });
      setOpportunities(result.opportunities);
      setTotal(result.total);
      setError(result.errors.length ? result.errors.join("; ") : null);
      setLastRun(result.scannedAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => void execute(true), [execute]);
  useEffect(() => {
    const timer = window.setTimeout(() => void execute(false), 0);
    const poll = window.setInterval(() => void execute(false), SCAN_REFRESH_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [execute]);

  return { opportunities, total, loading, error, lastRun, refresh };
}

export function useSdScan(enabled = true): {
  result: SdScanResult | null;
  loading: boolean;
  error: string | null;
  /** Symbols the scan could not read, as a number rather than as a sentence. */
  failedCount: number;
  lastRun: string | null;
  refresh: () => void;
} {
  const [result, setResult] = useState<SdScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const execute = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      const payload = await postScan<SignalsApiPayload>("/api/signals", { force });
      setResult(payload.result);
      // A count, not a sentence: the wording is chosen at render, where the
      // reader's language is known.
      setFailedCount(payload.result.errors.length);
      setError(null);
      setLastRun(payload.result.scannedAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => void execute(true), [execute]);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void execute(false), 0);
    const poll = window.setInterval(() => void execute(false), SCAN_REFRESH_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [execute, enabled]);

  return { result, loading, error, failedCount, lastRun, refresh };
}

export function useTopSetups(limit = 5): {
  top: TopSetup[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [top, setTop] = useState<TopSetup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      const payload = await postScan<SignalsApiPayload>("/api/signals", { force, limit });
      setTop(payload.top);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const refresh = useCallback(() => void execute(true), [execute]);
  useEffect(() => {
    const timer = window.setTimeout(() => void execute(false), 0);
    const poll = window.setInterval(() => void execute(false), SCAN_REFRESH_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [execute]);

  return { top, loading, error, refresh };
}

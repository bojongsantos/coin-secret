"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export async function adminJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? `Request failed (HTTP ${response.status}).`);
  return payload as T;
}

export function useAdminData<T>(url: string, valid: (value: unknown) => value is T) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setError(null);
    try {
      const payload = await adminJson<unknown>(url, { signal: request.signal });
      if (!valid(payload)) throw new Error("Invalid server response.");
      if (!request.signal.aborted) setData(payload);
    } catch (reason) {
      if (!request.signal.aborted) { setData(null); setError(reason instanceof Error ? reason.message : "Request failed."); }
    } finally { if (!request.signal.aborted) setLoading(false); }
  }, [url, valid]);
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 250);
    return () => { window.clearTimeout(timer); controller.current?.abort(); };
  }, [reload]);
  return { data, loading, error, reload };
}

export interface AdminList<T> { page: number; hasMore: boolean; rows: T[] }
export function isList(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return Array.isArray(payload[key]) && Number.isInteger(payload.page) && typeof payload.hasMore === "boolean";
}
export function AdminFeedback({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  return <div aria-live="polite">{loading && <p className="mt-4 text-sm text-muted">Loading…</p>}{error && <div role="alert" className="mt-4 rounded-lg border border-negative/30 p-3 text-sm text-negative">{error}<button type="button" onClick={retry} className="ml-3 underline">Retry</button></div>}</div>;
}
export function AdminPagination({ page, hasMore, disabled, change }: { page: number; hasMore: boolean; disabled: boolean; change: (page: number) => void }) {
  return <nav aria-label="Pagination" className="mt-4 flex items-center gap-4 text-sm"><button disabled={disabled || page <= 1} onClick={() => change(page - 1)} className="disabled:opacity-40">Previous</button><span>Page {page}</span><button disabled={disabled || !hasMore} onClick={() => change(page + 1)} className="disabled:opacity-40">Next</button></nav>;
}

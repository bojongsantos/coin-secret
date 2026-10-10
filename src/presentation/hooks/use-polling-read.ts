"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeReadFailure, readRetryDelay } from "@/shared/lib/read-failure";

interface PollingReadOptions<T> {
  enabled: boolean;
  accessKey?: string;
  invalidateEvent?: string;
  label: string;
  refreshMs: number;
  retainOnError?: boolean;
  read: (force: boolean, signal: AbortSignal) => Promise<T>;
  updatedAt: (data: T) => string;
}

interface ReadSnapshot<T> {
  accessKey?: string;
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  stale: boolean;
}

export function usePollingRead<T>({ enabled, accessKey, invalidateEvent, label, refreshMs, retainOnError = false, read, updatedAt }: PollingReadOptions<T>) {
  const empty: ReadSnapshot<T> = { accessKey, data: null, loading: enabled, error: null, lastUpdated: null, stale: false };
  const [snapshot, setSnapshot] = useState<ReadSnapshot<T>>(empty);
  const trigger = useRef<((force: boolean) => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let generation = 0;
    let request: AbortController | null = null;
    let timer: number | undefined;
    let failures = 0;
    let blockedUntil = 0;
    let resumePending = false;
    const online = () => navigator.onLine !== false;
    const ready = () => document.visibilityState !== "hidden" && online();
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void execute(false), Math.min(delay, 2_147_483_647));
    };
    const showOffline = () => {
      setSnapshot((current) => {
        const previous = current.accessKey === accessKey ? current : empty;
        const data = retainOnError ? previous.data : null;
        return { ...previous, data, loading: false, error: `You are offline. Reconnect to update ${label.toLowerCase()}.`, stale: data !== null };
      });
    };
    const execute = async (force: boolean) => {
      if (!active || request) return;
      if (document.visibilityState === "hidden") { schedule(refreshMs); return; }
      if (!online()) { window.clearTimeout(timer); showOffline(); return; }
      const wait = blockedUntil - Date.now();
      if (wait > 0) { schedule(wait); return; }
      window.clearTimeout(timer);
      const controller = new AbortController();
      const version = generation;
      request = controller;
      setSnapshot((current) => ({ ...(current.accessKey === accessKey ? current : empty), loading: true }));
      let nextDelay = refreshMs;
      try {
        const data = await read(force, controller.signal);
        if (!active || controller.signal.aborted || version !== generation) return;
        failures = 0;
        blockedUntil = 0;
        setSnapshot({ accessKey, data, loading: false, error: null, lastUpdated: updatedAt(data), stale: false });
      } catch (caught) {
        if (!active || controller.signal.aborted || version !== generation) return;
        const failure = normalizeReadFailure(caught, label);
        failures++;
        blockedUntil = Date.now() + failure.retryAfterMs;
        nextDelay = failure.retryable ? readRetryDelay(failures, refreshMs, failure.retryAfterMs) : refreshMs;
        setSnapshot((current) => {
          const previous = current.accessKey === accessKey ? current : empty;
          const data = retainOnError && failure.retryable ? previous.data : null;
          return { ...previous, data, loading: false, error: failure.message, stale: data !== null };
        });
      } finally {
        if (active && request === controller && version === generation) {
          request = null;
          if (ready()) schedule(resumePending ? 0 : nextDelay);
          else if (online()) schedule(refreshMs);
          resumePending = false;
        }
      }
    };
    const offline = () => {
      window.clearTimeout(timer);
      request?.abort();
      if (document.visibilityState !== "hidden") showOffline();
    };
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      if (!online()) { offline(); return; }
      if (request?.signal.aborted) resumePending = true;
      else void execute(false);
    };
    const invalidate = () => {
      generation++;
      request?.abort();
      request = null;
      failures = 0;
      blockedUntil = 0;
      resumePending = false;
      setSnapshot(empty);
      schedule(0);
    };
    trigger.current = (force) => { void execute(force); };
    schedule(0);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    if (invalidateEvent) window.addEventListener(invalidateEvent, invalidate);
    return () => {
      active = false;
      window.clearTimeout(timer);
      request?.abort();
      trigger.current = null;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      if (invalidateEvent) window.removeEventListener(invalidateEvent, invalidate);
    };
    // Snapshot is reset inside the scheduled read, avoiding a synchronous
    // state update in the effect. The return value hides old access immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, accessKey, invalidateEvent, label, refreshMs, retainOnError, read, updatedAt]);

  const current = enabled && snapshot.accessKey === accessKey ? snapshot : empty;
  return { ...current, loading: enabled && current.loading, refresh: useCallback(() => trigger.current?.(true), []) };
}

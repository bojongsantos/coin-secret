"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { notifyAuthStateChanged } from "@/infrastructure/auth/auth-client";

/** Only interactions send a write. Timers, focus and market polling only read. */
export function useSessionActivity(authenticated: boolean, onExpired?: () => void, sessionEpoch = 0) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!authenticated) return;
    let stopped = false;
    let inFlight = false;
    let queuedWrite = false;
    let queuedDeadline = false;
    let lastWrite = 0;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let activityTimer: ReturnType<typeof setTimeout> | undefined;

    function expired() {
      if (stopped) return;
      stopped = true;
      onExpired?.();
      notifyAuthStateChanged();
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      router.refresh();
    }

    async function sync(write = false, atDeadline = false) {
      if (stopped) return;
      if (inFlight) {
        queuedWrite ||= write;
        queuedDeadline ||= atDeadline;
        return;
      }
      inFlight = true;
      if (write) lastWrite = Date.now();
      try {
        const response = await fetch("/api/session/activity", {
          method: write ? "POST" : "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
          ...(write ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
        });
        if (stopped) return;
        if (response.status === 401) { expired(); return; }
        if (!response.ok) { if (atDeadline) expired(); return; }
        const data: { deadline: number; serverNow: number } = await response.json();
        if (!Number.isFinite(data.deadline) || !Number.isFinite(data.serverNow)) { if (atDeadline) expired(); return; }
        const remaining = data.deadline - data.serverNow;
        if (remaining <= 0) { expired(); return; }
        clearTimeout(deadlineTimer);
        // Use server durations so an incorrect device clock cannot delay logout.
        deadlineTimer = setTimeout(() => { void sync(false, true); }, remaining + 20);
      } catch {
        // Network failure never extends the deadline. The server still enforces it.
        if (atDeadline) expired();
      } finally {
        inFlight = false;
        if (!stopped && (queuedWrite || queuedDeadline)) {
          const writeNext = queuedWrite;
          const deadlineNext = queuedDeadline;
          queuedWrite = false;
          queuedDeadline = false;
          void sync(writeNext, deadlineNext);
        }
      }
    }

    function interact(event: Event) {
      if (stopped || !event.isTrusted || document.visibilityState !== "visible") return;
      const wait = Math.max(0, 30_000 - (Date.now() - lastWrite));
      if (activityTimer) return;
      activityTimer = setTimeout(() => {
        activityTimer = undefined;
        void sync(true);
      }, wait);
    }

    function resume() { if (document.visibilityState === "visible") void sync(); }
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
    for (const event of events) document.addEventListener(event, interact, { passive: true });
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    const checkTimer = setInterval(() => { void sync(); }, 60_000);
    // Fail closed if the initial authoritative session deadline cannot be read.
    void sync(false, true);
    return () => {
      stopped = true;
      clearTimeout(deadlineTimer);
      clearTimeout(activityTimer);
      clearInterval(checkTimer);
      for (const event of events) document.removeEventListener(event, interact);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [authenticated, onExpired, pathname, router, sessionEpoch]);
}

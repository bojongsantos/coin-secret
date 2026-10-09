"use client";

import { useEffect, useEffectEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { notifyAuthStateChanged } from "@/infrastructure/auth/auth-client";

/** Only interactions send a write. Timers, focus and market polling only read. */
export function useSessionActivity(authenticated: boolean, onExpired?: () => void, sessionEpoch = 0) {
  const router = useRouter();
  const pathname = usePathname();
  const expireSession = useEffectEvent(() => {
    onExpired?.();
    notifyAuthStateChanged();
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    router.refresh();
  });

  useEffect(() => {
    if (!authenticated) return;
    let stopped = false;
    let inFlight = false;
    let queuedWrite = false;
    let lastWrite = 0;
    let deadlineAt: number | undefined;
    let serverDeadline: number | undefined;
    let retryCount = 0;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let activityTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function expired() {
      if (stopped) return;
      stopped = true;
      expireSession();
    }

    function unavailable() {
      if (stopped) return;
      // An unknown initial deadline is not evidence of expiry. Server guards
      // continue to authorize every protected request while reads retry.
      if (deadlineAt !== undefined) {
        if (performance.now() >= deadlineAt) expired();
        return;
      }
      const delays = [2_000, 5_000];
      if (retryTimer !== undefined || retryCount >= delays.length) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void sync();
      }, delays[retryCount++]);
    }

    async function sync(write = false) {
      if (stopped) return;
      if (inFlight) {
        queuedWrite ||= write;
        return;
      }
      inFlight = true;
      if (write) lastWrite = Date.now();
      const started = performance.now();
      try {
        const response = await fetch("/api/session/activity", {
          method: write ? "POST" : "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
          ...(write ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
        });
        if (stopped) return;
        if (response.status === 401) { expired(); return; }
        if (!response.ok) { unavailable(); return; }
        const data: { deadline: number; serverNow: number } = await response.json();
        if (stopped) return;
        if (!Number.isFinite(data.deadline) || !Number.isFinite(data.serverNow)) { unavailable(); return; }
        // Subtract request latency, and never postpone the same server deadline
        // merely because a poll or focus read completes later.
        const observedDeadline = started + data.deadline - data.serverNow;
        deadlineAt = serverDeadline === data.deadline && deadlineAt !== undefined
          ? Math.min(deadlineAt, observedDeadline) : observedDeadline;
        serverDeadline = data.deadline;
        const remaining = deadlineAt - performance.now();
        if (remaining <= 0) { expired(); return; }
        clearTimeout(retryTimer);
        retryTimer = undefined;
        retryCount = 0;
        clearTimeout(deadlineTimer);
        // Use server durations so an incorrect device clock cannot delay logout.
        deadlineTimer = setTimeout(() => { void sync(); }, remaining + 20);
      } catch {
        // Network failure never extends the deadline. The server still enforces it.
        unavailable();
      } finally {
        inFlight = false;
        if (!stopped && queuedWrite) {
          queuedWrite = false;
          void sync(true);
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
    void sync();
    return () => {
      stopped = true;
      clearTimeout(deadlineTimer);
      clearTimeout(activityTimer);
      clearTimeout(retryTimer);
      clearInterval(checkTimer);
      for (const event of events) document.removeEventListener(event, interact);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [authenticated, sessionEpoch]);
}

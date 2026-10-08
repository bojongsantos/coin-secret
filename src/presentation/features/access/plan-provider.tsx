"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Plan } from "@/core/domain/models";
import { hasFeature, type FeatureKey } from "@/core/domain/access/gating";
import { AUTH_STATE_CHANGED_EVENT } from "@/infrastructure/auth/auth-client";
import { useSessionActivity } from "@/presentation/hooks/use-session-activity";

interface PlanContextValue {
  authenticated: boolean;
  plan: Plan;
  canAccess: (feature: FeatureKey) => boolean;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState(false);
  const [plan, setPlanState] = useState<Plan>("free");
  const [entitlements, setEntitlements] = useState<Partial<Record<FeatureKey, boolean>>>({});
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const sessionGeneration = useRef(0);
  const syncRequest = useRef(0);
  const knownAuthenticated = useRef(false);
  const expire = useCallback(() => {
    sessionGeneration.current++;
    knownAuthenticated.current = false;
    setSessionEpoch(sessionGeneration.current);
    setAuthenticated(false);
    setPlanState("free");
    setEntitlements({});
    setSessionExpired(true);
  }, []);
  useSessionActivity(authenticated, expire, sessionEpoch);

  const sync = useCallback(() => {
    const generation = sessionGeneration.current;
    const request = ++syncRequest.current;
    fetch("/api/entitlements", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to read account access");
        return response.json();
      })
      .then((data: { authenticated?: boolean; plan?: Plan; access?: Partial<Record<FeatureKey, boolean>> } | null) => {
        if (generation !== sessionGeneration.current || request !== syncRequest.current) return;
        if (knownAuthenticated.current && !data?.authenticated) {
          expire();
          return;
        }
        knownAuthenticated.current = data?.authenticated ?? false;
        setAuthenticated(data?.authenticated ?? false);
        setPlanState(data?.plan ?? "free");
        setEntitlements(data?.access ?? {});
        if (data?.authenticated) setSessionExpired(false);
      })
      .catch(() => {
        if (generation !== sessionGeneration.current || request !== syncRequest.current) return;
        // A failed access read is not a logout. Keep the session deadline monitor alive.
        setPlanState("free");
        setEntitlements({});
      });
  }, [expire]);

  useEffect(() => {
    sync();
  }, [pathname, sync]);

  useEffect(() => {
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [sync]);

  const canAccess = useCallback(
    (feature: FeatureKey) =>
      hasFeature(plan, feature, entitlements[feature]),
    [plan, entitlements],
  );

  const value = useMemo<PlanContextValue>(
    () => ({ authenticated, plan, canAccess }),
    [authenticated, plan, canAccess],
  );

  const publicAuthPage = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"].includes(pathname);
  return <PlanContext.Provider value={value}>
    {sessionExpired && !publicAuthPage ? (
      <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-border bg-surface p-6">
          <h1 className="text-xl font-bold">Session expired</h1>
          <p className="mt-2 text-sm text-muted">Sign in again to continue.</p>
          <Link href="/login" className="mt-5 inline-flex rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white">Sign in</Link>
        </div>
      </main>
    ) : children}
  </PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) {
    throw new Error("usePlan must be used within a PlanProvider");
  }
  return ctx;
}

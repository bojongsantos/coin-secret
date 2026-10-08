"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
  useSessionActivity(authenticated);

  const sync = useCallback(() => {
    fetch("/api/entitlements", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { authenticated?: boolean; plan?: Plan; access?: Partial<Record<FeatureKey, boolean>> } | null) => {
        setAuthenticated(data?.authenticated ?? false);
        setPlanState(data?.plan ?? "free");
        setEntitlements(data?.access ?? {});
      })
      .catch(() => {
        setAuthenticated(false);
        setPlanState("free");
        setEntitlements({});
      });
  }, []);

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

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) {
    throw new Error("usePlan must be used within a PlanProvider");
  }
  return ctx;
}

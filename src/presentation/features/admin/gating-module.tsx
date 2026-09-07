"use client";

import { useCallback, useEffect, useState } from "react";
import { featureLabel, PREMIUM_FEATURES, type FeatureKey } from "@/core/domain/access/gating";
import { useT } from "@/presentation/hooks/use-translate";

interface Gate { id: string; feature: string; free: boolean; premium: boolean }

export function GatingModule() {
  const { t } = useT();
  const [gates, setGates] = useState<Gate[]>([]);
  const load = useCallback(async () => { const response = await fetch("/api/admin/feature-gates", { cache: "no-store" }); const payload = await response.json() as { gates?: Gate[] }; setGates(payload.gates ?? []); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function setGate(feature: FeatureKey, free: boolean, premium: boolean) { await fetch("/api/admin/feature-gates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature, free, premium }) }); await load(); }
  return <div className="p-6"><h2 className="text-lg font-bold">Feature Gating</h2><p className="mt-1 text-xs text-muted">{t("admin.gatingBlurb")}</p><div className="mt-5 card divide-y divide-border">{PREMIUM_FEATURES.map((feature) => { const gate = gates.find((item) => item.feature === feature); const free = gate?.free ?? false; const premium = gate?.premium ?? true; return <div key={feature} className="flex flex-wrap items-center gap-4 p-4"><div className="min-w-60 flex-1"><p className="text-sm font-semibold">{featureLabel[feature]}</p><p className="text-xs text-muted-2">{feature}</p></div><label className="flex items-center gap-2 text-xs">Free<input type="checkbox" checked={free} onChange={(e) => void setGate(feature, e.target.checked, premium)} /></label><label className="flex items-center gap-2 text-xs">Premium<input type="checkbox" checked={premium} onChange={(e) => void setGate(feature, free, e.target.checked)} /></label></div>; })}</div></div>;
}

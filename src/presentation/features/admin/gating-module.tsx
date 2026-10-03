"use client";
import { useState } from "react";
import { z } from "zod";
import { featureLabel, PREMIUM_FEATURES, type FeatureKey } from "@/core/domain/access/gating";
import { AdminFeedback, adminJson, useAdminData } from "./admin-data";
interface Gate { feature: string; free: boolean; premium: boolean }
interface Gates { gates: Gate[] }
const schema = z.object({ gates: z.array(z.object({ feature: z.string(), free: z.boolean(), premium: z.boolean() })) });
const valid = (value: unknown): value is Gates => schema.safeParse(value).success;
export function GatingModule() {
  const { data, loading, error, reload } = useAdminData("/api/admin/feature-gates", valid);
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState<string | null>(null);
  async function setGate(feature: FeatureKey, free: boolean, premium: boolean) {
    if (saving || !window.confirm(`Change access to ${feature} for all users?`)) return;
    setSaving(true); setMessage(null);
    try { await adminJson("/api/admin/feature-gates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature, free, premium }) }); setMessage("Access rules saved."); await reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Access rules could not be saved."); }
    finally { setSaving(false); }
  }
  return <div className="p-4 sm:p-6"><h2 className="text-lg font-bold">Feature Gating</h2><p className="mt-1 text-xs text-muted">Global per-plan access rules.</p><AdminFeedback loading={loading} error={error} retry={() => void reload()} />{message && <p role="status" className="mt-3 text-sm">{message}</p>}{!loading && data && <div className="mt-5 card divide-y divide-border">{PREMIUM_FEATURES.map((feature) => { const gate = data.gates.find((item) => item.feature === feature); const free = gate?.free ?? false; const premium = gate?.premium ?? true; return <div key={feature} className="flex flex-wrap items-center gap-4 p-4"><div className="min-w-0 flex-1 basis-48"><p className="text-sm">{featureLabel[feature]}</p><p className="text-xs text-muted-2">{feature}</p></div><label className="flex items-center gap-2 text-xs">Free<input aria-label={`Free access to ${feature}`} disabled={saving} type="checkbox" checked={free} onChange={(e) => void setGate(feature, e.target.checked, premium)} /></label><label className="flex items-center gap-2 text-xs">Premium<input aria-label={`Premium access to ${feature}`} disabled={saving} type="checkbox" checked={premium} onChange={(e) => void setGate(feature, free, e.target.checked)} /></label></div>; })}</div>}</div>;
}

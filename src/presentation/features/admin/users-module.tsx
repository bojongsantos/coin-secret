"use client";
import { useState } from "react";
import { z } from "zod";
import { AdminFeedback, AdminPagination, adminJson, isList, useAdminData } from "./admin-data";
interface AdminUser { id: string; name: string; email: string; role: "USER" | "ADMIN"; plan: "FREE" | "PREMIUM"; subscription: { status: string; provider: string | null; currentPeriodStart: string | null; currentPeriodEnd: string | null } | null; _count: { sessions: number; payments: number } }
interface Users { users: AdminUser[]; page: number; hasMore: boolean }
type UserChange = { role?: AdminUser["role"]; plan?: AdminUser["plan"]; currentPeriodEnd?: string | null };
const schema = z.object({ users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.enum(["USER", "ADMIN"]), plan: z.enum(["FREE", "PREMIUM"]), subscription: z.object({ status: z.string(), provider: z.string().nullable(), currentPeriodStart: z.string().nullable(), currentPeriodEnd: z.string().nullable() }).nullable(), _count: z.object({ sessions: z.number(), payments: z.number() }) })) });
const valid = (value: unknown): value is Users => isList(value, "users") && schema.safeParse(value).success;
function ExpiryControl({ user, saving, update }: { user: AdminUser; saving: boolean; update: (id: string, change: UserChange) => Promise<void> }) {
  const end = user.subscription?.currentPeriodEnd;
  const initial = end ? new Date(new Date(end).getTime() - new Date(end).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
  const [value, setValue] = useState(initial);
  return <div className="min-w-48 space-y-1.5">
    <p className="text-muted">{user.subscription?.provider === "trial" ? "7-day trial" : user.subscription?.provider ?? "No access period"}{end && new Date(end) <= new Date() ? " · Expired" : ""}</p>
    <input type="datetime-local" aria-label={`Access expiry for ${user.email}`} disabled={saving || user.plan !== "PREMIUM"} value={value} onChange={(event) => setValue(event.target.value)} className="w-full rounded border border-border bg-background p-1.5" />
    <p className="text-[10px] text-muted">Local time. Empty means no expiry.</p>
    <button type="button" disabled={saving || user.plan !== "PREMIUM" || value === initial} onClick={() => void update(user.id, { currentPeriodEnd: value ? new Date(value).toISOString() : null })} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Save expiry</button>
  </div>;
}
export function UsersModule() {
  const [query, setQuery] = useState(""); const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdminData(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`, valid);
  async function update(id: string, change: UserChange) {
    if (saving || !window.confirm(change.currentPeriodEnd !== undefined ? "Apply this access expiry? This replaces the current paid or trial expiry with a manual admin grant." : change.plan ? "Apply this plan? A new manual Pro grant has no expiry; set its date in Access expiry." : "Apply this role change? Demotion ends the user's current sessions.")) return;
    setSaving(true); setMessage(null);
    try { await adminJson(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) }); setMessage("Changes saved."); await reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Changes could not be saved."); }
    finally { setSaving(false); }
  }
  return <div className="p-4 sm:p-6"><h2 className="text-lg font-bold">Users</h2><p className="mt-1 text-xs text-muted">Manage roles, plans, trial periods, and access expiry dates.</p><input aria-label="Search users" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search name or email" className="mt-5 w-full max-w-md rounded-lg border border-border bg-surface-3 px-3 py-2 text-sm" />
    <AdminFeedback loading={loading} error={error} retry={() => void reload()} />{message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {!loading && data && <><div className="mt-4 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[1000px] text-left text-xs"><thead className="bg-surface-3 text-muted"><tr>{["User", "Role", "Plan", "Access expiry", "Sessions", "Payments"].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>
      {data.users.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">No users match your search.</td></tr>}
      {data.users.map((user) => <tr key={user.id} className="border-t border-border"><td className="p-3"><p className="font-semibold">{user.name}</p><p className="text-muted">{user.email}</p></td><td className="p-3"><select aria-label={`Role for ${user.email}`} disabled={saving} value={user.role} onChange={(e) => void update(user.id, { role: e.target.value as AdminUser["role"] })} className="rounded border border-border bg-background p-1.5"><option>USER</option><option>ADMIN</option></select></td><td className="p-3"><select aria-label={`Plan for ${user.email}`} disabled={saving} value={user.plan} onChange={(e) => void update(user.id, { plan: e.target.value as AdminUser["plan"] })} className="rounded border border-border bg-background p-1.5"><option>FREE</option><option>PREMIUM</option></select></td><td className="p-3"><ExpiryControl key={`${user.id}:${user.subscription?.currentPeriodEnd}`} user={user} saving={saving} update={update} /></td><td className="p-3">{user._count.sessions}</td><td className="p-3">{user._count.payments}</td></tr>)}</tbody></table></div><AdminPagination page={data.page} hasMore={data.hasMore} disabled={saving || loading} change={setPage} /></>}
  </div>;
}

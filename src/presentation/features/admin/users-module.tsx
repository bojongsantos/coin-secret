"use client";
import { useState } from "react";
import { z } from "zod";
import { AdminFeedback, AdminPagination, adminJson, isList, useAdminData } from "./admin-data";
interface AdminUser { id: string; name: string; email: string; role: "USER" | "ADMIN"; plan: "FREE" | "PREMIUM"; _count: { sessions: number; payments: number } }
interface Users { users: AdminUser[]; page: number; hasMore: boolean }
const schema = z.object({ users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.enum(["USER", "ADMIN"]), plan: z.enum(["FREE", "PREMIUM"]), _count: z.object({ sessions: z.number(), payments: z.number() }) })) });
const valid = (value: unknown): value is Users => isList(value, "users") && schema.safeParse(value).success;
export function UsersModule() {
  const [query, setQuery] = useState(""); const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdminData(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`, valid);
  async function update(id: string, change: { role?: AdminUser["role"]; plan?: AdminUser["plan"] }) {
    if (saving || !window.confirm(change.plan ? "Apply this plan? Manual Pro access has no expiry until changed by an admin." : "Apply this role change? Demotion ends the user's current sessions.")) return;
    setSaving(true); setMessage(null);
    try { await adminJson(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) }); setMessage("Changes saved."); await reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Changes could not be saved."); }
    finally { setSaving(false); }
  }
  return <div className="p-4 sm:p-6"><h2 className="text-lg font-bold">Users</h2><p className="mt-1 text-xs text-muted">Manage user roles and manual plans. Manual Pro grants have no expiry.</p><input aria-label="Search users" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search name or email" className="mt-5 w-full max-w-md rounded-lg border border-border bg-surface-3 px-3 py-2 text-sm" />
    <AdminFeedback loading={loading} error={error} retry={() => void reload()} />{message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {!loading && data && <><div className="mt-4 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[800px] text-left text-xs"><thead className="bg-surface-3 text-muted"><tr>{["User", "Role", "Plan", "Sessions", "Payments"].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>
      {data.users.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">No users match your search.</td></tr>}
      {data.users.map((user) => <tr key={user.id} className="border-t border-border"><td className="p-3"><p className="font-semibold">{user.name}</p><p className="text-muted">{user.email}</p></td><td className="p-3"><select aria-label={`Role for ${user.email}`} disabled={saving} value={user.role} onChange={(e) => void update(user.id, { role: e.target.value as AdminUser["role"] })} className="rounded border border-border bg-background p-1.5"><option>USER</option><option>ADMIN</option></select></td><td className="p-3"><select aria-label={`Plan for ${user.email}`} disabled={saving} value={user.plan} onChange={(e) => void update(user.id, { plan: e.target.value as AdminUser["plan"] })} className="rounded border border-border bg-background p-1.5"><option>FREE</option><option>PREMIUM</option></select></td><td className="p-3">{user._count.sessions}</td><td className="p-3">{user._count.payments}</td></tr>)}</tbody></table></div><AdminPagination page={data.page} hasMore={data.hasMore} disabled={saving || loading} change={setPage} /></>}
  </div>;
}

"use client";

import { useCallback, useEffect, useState } from "react";

interface AdminUser { id: string; name: string; email: string; role: "USER" | "ADMIN"; plan: "FREE" | "PREMIUM"; emailVerified: boolean; createdAt: string; _count: { sessions: number; payments: number } }

export function UsersModule() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => { const response = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}`, { cache: "no-store" }); const payload = await response.json() as { users?: AdminUser[] }; setUsers(payload.users ?? []); }, [query]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  async function update(id: string, data: Partial<Pick<AdminUser, "role" | "plan">>) { await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); await load(); }
  return <div className="p-6"><h2 className="text-lg font-bold">Users</h2><p className="mt-1 text-xs text-muted">Role dan paket dikelola terpisah.</p><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama atau email…" className="mt-5 w-full max-w-md rounded-lg border border-border bg-surface-3 px-3 py-2 text-sm" /><div className="mt-4 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[800px] text-left text-xs"><thead className="bg-surface-3 text-muted"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Plan</th><th className="p-3">Sessions</th><th className="p-3">Payments</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t border-border"><td className="p-3"><p className="font-semibold">{user.name}</p><p className="text-muted">{user.email}</p></td><td className="p-3"><select value={user.role} onChange={(e) => void update(user.id, { role: e.target.value as AdminUser["role"] })} className="rounded border border-border bg-background p-1.5"><option>USER</option><option>ADMIN</option></select></td><td className="p-3"><select value={user.plan} onChange={(e) => void update(user.id, { plan: e.target.value as AdminUser["plan"] })} className="rounded border border-border bg-background p-1.5"><option>FREE</option><option>PREMIUM</option></select></td><td className="p-3">{user._count.sessions}</td><td className="p-3">{user._count.payments}</td></tr>)}</tbody></table></div></div>;
}

"use client";
import { useState } from "react";
import { z } from "zod";
import { AdminFeedback, AdminPagination, isList, useAdminData } from "./admin-data";
interface AuditRow { id: string; action: string; entityType: string; entityId: string | null; ipAddress: string | null; createdAt: string; actor: { email: string } | null }
interface Logs { logs: AuditRow[]; page: number; hasMore: boolean }
const schema = z.object({ logs: z.array(z.object({ id: z.string(), action: z.string(), entityType: z.string(), entityId: z.string().nullable(), ipAddress: z.string().nullable(), createdAt: z.string(), actor: z.object({ email: z.string() }).nullable() })) });
const valid = (value: unknown): value is Logs => isList(value, "logs") && schema.safeParse(value).success;
export function AuditModule() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAdminData(`/api/admin/audit-logs?page=${page}`, valid);
  return <div className="p-4 sm:p-6"><h2 className="text-lg font-bold">Audit Log</h2><p className="mt-1 text-xs text-muted">Backend activity, newest first. System includes historical events whose actor account was removed.</p><AdminFeedback loading={loading} error={error} retry={() => void reload()} />{!loading && data && <><div className="mt-5 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[800px] text-left text-xs"><thead className="bg-surface-3 text-muted"><tr>{["Time", "Actor", "Action", "Entity", "IP"].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>
    {!data.logs.length && <tr><td colSpan={5} className="p-6 text-center text-muted">No audit events on this page.</td></tr>}
    {data.logs.map((log) => <tr key={log.id} className="border-t border-border"><td className="p-3">{new Date(log.createdAt).toLocaleString()}</td><td className="p-3">{log.actor?.email ?? "System / removed account"}</td><td className="p-3 font-mono">{log.action}</td><td className="p-3">{log.entityType}<p className="font-mono text-muted">{log.entityId}</p></td><td className="p-3 font-mono">{log.ipAddress ?? "—"}</td></tr>)}</tbody></table></div><AdminPagination page={data.page} hasMore={data.hasMore} disabled={loading} change={setPage} /></>}</div>;
}

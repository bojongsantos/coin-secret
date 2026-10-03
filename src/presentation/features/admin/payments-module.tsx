"use client";
import { useState } from "react";
import { z } from "zod";
import { AdminFeedback, AdminPagination, isList, useAdminData } from "./admin-data";
interface PaymentRow { id: string; orderId: string; amount: number; currency: string; status: string; rawStatus: string | null; createdAt: string; paidAt: string | null; needsReconciliation: boolean; user: { name: string; email: string } }
interface Payments { payments: PaymentRow[]; page: number; hasMore: boolean }
const schema = z.object({ payments: z.array(z.object({ id: z.string(), orderId: z.string(), amount: z.number(), currency: z.string().regex(/^[A-Z]{3}$/), status: z.string(), rawStatus: z.string().nullable(), createdAt: z.string(), paidAt: z.string().nullable(), needsReconciliation: z.boolean(), user: z.object({ name: z.string(), email: z.string() }) })) });
const valid = (value: unknown): value is Payments => isList(value, "payments") && schema.safeParse(value).success;
export function PaymentsModule() {
  const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAdminData(`/api/admin/payments?status=${status}&page=${page}`, valid);
  return <div className="p-4 sm:p-6"><h2 className="text-lg font-bold">Payments</h2><p className="mt-1 text-xs text-muted">Provider-confirmed statuses. Old pending orders require provider reconciliation; age alone cannot confirm failure.</p><div className="mt-5 flex gap-3"><select aria-label="Payment status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-border bg-surface-3 px-3 py-2 text-sm"><option value="">All statuses</option>{["PENDING", "SETTLED", "FAILED", "EXPIRED", "CANCELED", "REFUNDED"].map((value) => <option key={value}>{value}</option>)}</select><button disabled={loading} onClick={() => void reload()}>Refresh</button></div>
    <AdminFeedback loading={loading} error={error} retry={() => void reload()} />{!loading && data && <><div className="mt-4 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-surface-3 text-muted"><tr>{["Order", "User", "Amount", "Status", "Created", "Paid"].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>
    {!data.payments.length && <tr><td colSpan={6} className="p-6 text-center text-muted">No payments match this filter.</td></tr>}
    {data.payments.map((payment) => <tr key={payment.id} className="border-t border-border"><td className="p-3 font-mono">{payment.orderId}</td><td className="p-3"><p>{payment.user.name}</p><p className="text-muted">{payment.user.email}</p></td><td className="p-3">{new Intl.NumberFormat("en-US", { style: "currency", currency: payment.currency }).format(payment.amount)}</td><td className="p-3">{payment.status}<p className="text-muted">{payment.rawStatus}</p>{payment.needsReconciliation && <p className="text-negative">Needs reconciliation</p>}</td><td className="p-3">{new Date(payment.createdAt).toLocaleString()}</td><td className="p-3">{payment.paidAt ? new Date(payment.paidAt).toLocaleString() : "â€”"}</td></tr>)}</tbody></table></div><AdminPagination page={data.page} hasMore={data.hasMore} disabled={loading} change={setPage} /></>}
  </div>;
}



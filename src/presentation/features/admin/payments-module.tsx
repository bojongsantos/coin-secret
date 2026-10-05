"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { adminJson, AdminFeedback, AdminPagination, isList, useAdminData } from "./admin-data";
import { paymentIdentityLocked } from "@/core/domain/billing/payment-rules";

const rowSchema = z.object({
  id: z.string(), orderId: z.string(), provider: z.string(), providerTransactionId: z.string().nullable(),
  amount: z.number(), currency: z.string().regex(/^[A-Z]{3}$/), status: z.string(), rawStatus: z.string().nullable(),
  createdAt: z.string(), paidAt: z.string().nullable(), needsReconciliation: z.boolean(),
  user: z.object({ name: z.string(), email: z.string() }),
});
type PaymentRow = z.infer<typeof rowSchema>;
interface Payments { payments: PaymentRow[]; page: number; hasMore: boolean }
const schema = z.object({ payments: z.array(rowSchema) });
const valid = (value: unknown): value is Payments => isList(value, "payments") && schema.safeParse(value).success;

export function PaymentsModule() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PaymentRow | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdminData(`/api/admin/payments?status=${status}&page=${page}`, valid);

  async function reconcile() {
    if (!selected || working.current) return;
    working.current = true;
    setBusy(true); setFeedback(null); setMutationError(null);
    try {
      const result = await adminJson<{ status: string; providerStatus: string; requiresReview: boolean }>(`/api/admin/payments/${encodeURIComponent(selected.id)}/reconcile`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paymentId ? { paymentId } : {}),
      });
      setFeedback(`Provider confirmed ${result.providerStatus}. Stored status: ${result.status}.${result.requiresReview ? " Refund access requires manual ledger review." : ""}`);
      setSelected(null);
      await reload();
    } catch (reason) { setMutationError(reason instanceof Error ? reason.message : "Status verification failed."); }
    finally { working.current = false; setBusy(false); }
  }

  return <div className="p-4 sm:p-6">
    <h2 className="text-lg font-bold">Payments</h2>
    <p className="mt-1 text-xs text-muted">Provider-confirmed statuses. An order&apos;s age alone cannot confirm failure.</p>
    <div className="mt-5 flex gap-3"><select aria-label="Payment status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-border bg-surface-3 px-3 py-2 text-sm"><option value="">All statuses</option>{["PENDING", "SETTLED", "FAILED", "EXPIRED", "CANCELED", "REFUNDED"].map((value) => <option key={value}>{value}</option>)}</select><button disabled={loading || busy} onClick={() => void reload()}>Refresh</button></div>
    <AdminFeedback loading={loading} error={error} retry={() => void reload()} />
    <div aria-live="polite">{feedback && <p className="mt-4 text-sm text-positive">{feedback}</p>}{mutationError && <p role="alert" className="mt-4 text-sm text-negative">{mutationError}</p>}</div>
    {selected && <form className="mt-4 rounded-xl border border-border p-4 text-sm" onSubmit={(event) => { event.preventDefault(); void reconcile(); }}>
      <p>Verify {selected.orderId} with {selected.provider}</p>
      <p className="mt-2 text-xs text-muted">Enter the actual payment ID from the provider account. An invoice ID cannot be used. Access changes only after the provider confirms this order, amount and currency.</p>
      <label className="mt-3 block">Payment ID<input autoFocus required value={paymentId} onChange={(event) => setPaymentId(event.target.value)} inputMode="numeric" pattern="[0-9]{1,30}" maxLength={30} disabled={busy || (!!selected.providerTransactionId && paymentIdentityLocked(selected))} className="mt-1 block w-full max-w-sm rounded-lg border border-border bg-surface-3 px-3 py-2" /></label>
      <div className="mt-3 flex gap-3"><button type="submit" disabled={busy || !/^\d{1,30}$/.test(paymentId)} className="rounded-lg bg-primary px-3 py-2 disabled:opacity-50">{busy ? "Verifying…" : "Verify with provider"}</button><button type="button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button></div>
    </form>}
    {!loading && data && <><div className="mt-4 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[950px] text-left text-xs"><thead className="bg-surface-3 text-muted"><tr>{["Order", "User", "Amount", "Status", "Created", "Paid", "Verify"].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>
      {!data.payments.length && <tr><td colSpan={7} className="p-6 text-center text-muted">No payments match this filter.</td></tr>}
      {data.payments.map((payment) => <tr key={payment.id} className="border-t border-border"><td className="p-3 font-mono">{payment.orderId}<p className="text-muted">{payment.provider}</p></td><td className="p-3"><p>{payment.user.name}</p><p className="text-muted">{payment.user.email}</p></td><td className="p-3">{new Intl.NumberFormat("en-US", { style: "currency", currency: payment.currency }).format(payment.amount)}</td><td className="p-3">{payment.status}<p className="text-muted">{payment.rawStatus}</p>{payment.needsReconciliation && <p className="text-negative">Needs reconciliation</p>}</td><td className="p-3">{new Date(payment.createdAt).toLocaleString()}</td><td className="p-3">{payment.paidAt ? new Date(payment.paidAt).toLocaleString() : "—"}</td><td className="p-3">{["nowpayments", "nowpayments-sandbox"].includes(payment.provider) ? <button disabled={busy} onClick={() => { setSelected(payment); setPaymentId(payment.providerTransactionId ?? ""); setMutationError(null); }} className="underline">Verify status</button> : "Provider account"}</td></tr>)}
    </tbody></table></div><AdminPagination page={data.page} hasMore={data.hasMore} disabled={loading || busy} change={setPage} /></>}
  </div>;
}

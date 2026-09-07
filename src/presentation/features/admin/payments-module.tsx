"use client";

import { useEffect, useState } from "react";
import { useT } from "@/presentation/hooks/use-translate";

interface PaymentRow { id: string; orderId: string; amount: number; currency: string; status: string; rawStatus: string | null; createdAt: string; paidAt: string | null; user: { name: string; email: string } }

export function PaymentsModule() {
  const { t } = useT();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [status, setStatus] = useState("");
  useEffect(() => { const controller = new AbortController(); fetch(`/api/admin/payments?status=${status}`, { cache: "no-store", signal: controller.signal }).then((response) => response.json()).then((payload: { payments?: PaymentRow[] }) => setPayments(payload.payments ?? [])).catch(() => undefined); return () => controller.abort(); }, [status]);
  return <div className="p-6"><h2 className="text-lg font-bold">Payments</h2><p className="mt-1 text-xs text-muted">{t("admin.paymentsBlurb")}</p><select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-5 rounded-lg border border-border bg-surface-3 px-3 py-2 text-sm"><option value="">{t("admin.allStatuses")}</option>{["PENDING", "SETTLED", "FAILED", "EXPIRED", "CANCELED", "REFUNDED"].map((value) => <option key={value}>{value}</option>)}</select><div className="mt-4 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-surface-3 text-muted"><tr><th className="p-3">Order</th><th className="p-3">User</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Created</th><th className="p-3">Paid</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className="border-t border-border"><td className="p-3 font-mono">{payment.orderId}</td><td className="p-3"><p className="font-semibold">{payment.user.name}</p><p className="text-muted">{payment.user.email}</p></td><td className="p-3">{new Intl.NumberFormat("id-ID", { style: "currency", currency: payment.currency, maximumFractionDigits: 0 }).format(payment.amount)}</td><td className="p-3 font-semibold">{payment.status}<p className="font-normal text-muted">{payment.rawStatus}</p></td><td className="p-3">{new Date(payment.createdAt).toLocaleString("id-ID")}</td><td className="p-3">{payment.paidAt ? new Date(payment.paidAt).toLocaleString("id-ID") : "—"}</td></tr>)}</tbody></table></div></div>;
}

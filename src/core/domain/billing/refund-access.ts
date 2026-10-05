export interface PaidAccessPeriod {
  id: string;
  accessStartsAt: Date | null;
  accessEndsAt: Date | null;
}

export interface RefundAccessChange {
  requiresReview: boolean;
  periodEnd: Date | null;
  shifted: Array<{ id: string; accessStartsAt: Date; accessEndsAt: Date }>;
}

/** Remove only unused refunded time; never remove another purchase's days. */
export function accessAfterRefund(
  currentEnd: Date | null,
  refunded: PaidAccessPeriod,
  remaining: PaidAccessPeriod[],
  now: Date,
): RefundAccessChange {
  const review: RefundAccessChange = { requiresReview: true, periodEnd: currentEnd, shifted: [] };
  const valid = (period: PaidAccessPeriod) => period.accessStartsAt != null &&
    period.accessEndsAt != null && Number.isFinite(period.accessStartsAt.getTime()) &&
    Number.isFinite(period.accessEndsAt.getTime()) && period.accessEndsAt > period.accessStartsAt;
  if (!currentEnd || !valid(refunded) || remaining.some((period) => !valid(period))) return review;
  const start = refunded.accessStartsAt!.getTime();
  const end = refunded.accessEndsAt!.getTime();
  // An independent/manual period or missing ledger must not be silently erased.
  const ledgerEnd = Math.max(end, ...remaining.map((period) => period.accessEndsAt!.getTime()));
  if (ledgerEnd !== currentEnd.getTime()) return review;
  if (remaining.some((period) => period.accessStartsAt!.getTime() < end &&
    period.accessEndsAt!.getTime() > start)) return review;
  // Unknown/manual time before a queued purchase must survive its refund.
  // Only adjust a complete, non-overlapping ledger of still-active time.
  const active = [refunded, ...remaining].filter((period) => period.accessEndsAt! > now)
    .sort((a, b) => a.accessStartsAt!.getTime() - b.accessStartsAt!.getTime());
  let covered = now.getTime();
  let previousEnd: number | null = null;
  for (const period of active) {
    const begins = period.accessStartsAt!.getTime();
    if (begins > covered || (previousEnd !== null && begins < previousEnd)) return review;
    covered = previousEnd = period.accessEndsAt!.getTime();
  }
  if (currentEnd > now && covered !== currentEnd.getTime()) return review;

  const unused = Math.max(0, end - Math.max(start, now.getTime()));
  const shifted = remaining.filter((period) => unused > 0 && period.accessStartsAt!.getTime() >= end)
    .map((period) => ({
      id: period.id,
      accessStartsAt: new Date(period.accessStartsAt!.getTime() - unused),
      accessEndsAt: new Date(period.accessEndsAt!.getTime() - unused),
    }));
  const changed = new Map(shifted.map((period) => [period.id, period]));
  const remainingEnd = Math.max(now.getTime(), ...remaining.map((period) =>
    (changed.get(period.id) ?? period).accessEndsAt!.getTime()));
  return { requiresReview: false, periodEnd: new Date(remainingEnd), shifted };
}

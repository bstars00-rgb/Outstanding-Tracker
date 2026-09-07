import { buildTrackerModel } from './calc';
import { round2 } from './money';
import type { FxTable, ISODate, Invoice, ReceivablesDataset, Snapshot } from './types';
import { validateDataset } from './validate';

/**
 * Derive the dataset as it would have looked on an earlier reference date.
 * Used (a) by the mock adapter to produce a consistent 12-week snapshot history and
 * (b) by the live pipeline to re-create a Saturday snapshot from dated transactions
 * when the source system does not expose historical snapshots itself.
 *
 * Rules: invoices dated after `date` are dropped; payments/activities after `date` are dropped
 * and paid_amount / outstanding_amount / status are recomputed from the remaining payments.
 * Credit notes and cancellations are not dated in the source model and are kept as-is (documented limitation).
 */
export function datasetAsOf(full: ReceivablesDataset, date: ISODate, fx: FxTable = full.fx, asOf?: string): ReceivablesDataset {
  const payments = full.payments.filter((p) => p.payment_date <= date);
  const activities = full.activities.filter((a) => a.activity_date <= date).map((a) => ({ ...a, completed: a.completed && (a.next_action_date ?? a.activity_date) <= date }));
  const appliedByInvoice = new Map<string, { amount: number; last: string; lastAmount: number }>();
  for (const p of payments) {
    if (!p.invoice_id || p.reconciliation_status === 'REFUNDED') continue;
    const cur = appliedByInvoice.get(p.invoice_id) ?? { amount: 0, last: '', lastAmount: 0 };
    cur.amount = round2(cur.amount + p.applied_amount);
    if (p.payment_date >= cur.last) {
      cur.last = p.payment_date;
      cur.lastAmount = p.applied_amount;
    }
    appliedByInvoice.set(p.invoice_id, cur);
  }
  const invoices: Invoice[] = full.invoices
    .filter((i) => i.invoice_date <= date)
    .map((i) => {
      const applied = appliedByInvoice.get(i.invoice_id);
      const paid = applied?.amount ?? 0;
      const outstanding = round2(i.original_amount - paid - i.credit_note_amount);
      let status = i.invoice_status;
      if (status !== 'CANCELLED' && status !== 'WRITTEN_OFF' && status !== 'CREDITED') {
        if (outstanding <= 0) status = 'PAID';
        else if (paid > 0) status = i.dispute_status === 'OPEN' || i.dispute_status === 'UNDER_REVIEW' ? 'DISPUTED' : 'PARTIALLY_PAID';
        else status = i.dispute_status === 'OPEN' || i.dispute_status === 'UNDER_REVIEW' ? 'DISPUTED' : 'OPEN';
      }
      return { ...i, paid_amount: paid, outstanding_amount: Math.max(0, outstanding), invoice_status: status, last_payment_date: applied?.last || null, last_payment_amount: applied ? applied.lastAmount : null };
    });
  return {
    ...full,
    as_of: asOf ?? `${date}T02:00:00.000Z`,
    fx: { ...fx, as_of: date },
    invoices,
    payments,
    activities,
  };
}

export interface HistoryPoint {
  date: ISODate;
  snapshot: Snapshot;
}

/** Build a chain of weekly snapshots (oldest first). `fxFor` supplies the FX table valid on each date. */
export function buildSnapshotHistory(full: ReceivablesDataset, dates: ISODate[], fxFor: (date: ISODate) => FxTable): HistoryPoint[] {
  const sorted = [...dates].sort();
  const out: HistoryPoint[] = [];
  let prev: Snapshot | null = null;
  for (const d of sorted) {
    const ds = datasetAsOf(full, d, fxFor(d));
    const v = validateDataset(ds);
    const model = buildTrackerModel(ds, { referenceDate: d, previousSnapshot: prev, validationIssues: v.issues });
    out.push({ date: d, snapshot: model.snapshot });
    prev = model.snapshot;
  }
  return out;
}

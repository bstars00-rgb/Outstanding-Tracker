import { agingDays, bucketFor, emptyBuckets } from './aging';
import { addDays, daysBetween, inRange, reportWeek } from './dates';
import { convert, round2 } from './money';
import { computeRiskScore, DEFAULT_RISK_CONFIG, type RiskConfig } from './risk';
import { buildActions } from './actions';
import { buildKpis } from './kpis';
import type {
  AgingBucket,
  CalculatedInvoice,
  CollectionActivity,
  Customer,
  CustomerRisk,
  DataQualityIssue,
  DimensionAging,
  ISODate,
  Payment,
  ReceivablesDataset,
  Snapshot,
  SnapshotCustomerRow,
  SnapshotDimensionRow,
  SnapshotInvoiceState,
  TrackerModel,
} from './types';
import { AGING_BUCKETS } from './types';

export interface BuildOptions {
  referenceDate: ISODate;
  previousSnapshot: Snapshot | null;
  riskConfig?: RiskConfig;
  /** Data quality issues found by validateDataset(); merged into the model. */
  validationIssues?: DataQualityIssue[];
}

/** Invoices in these states never carry outstanding balance. */
const CLOSED_STATUSES = new Set(['CANCELLED', 'WRITTEN_OFF']);

export function buildTrackerModel(ds: ReceivablesDataset, opts: BuildOptions): TrackerModel {
  const ref = opts.referenceDate;
  const prev = opts.previousSnapshot;
  const riskCfg = opts.riskConfig ?? DEFAULT_RISK_CONFIG;
  const issues: DataQualityIssue[] = [...(opts.validationIssues ?? [])];
  const week = reportWeek(ref, prev?.snapshot_date ?? null);
  const rc = ds.reporting_currency;

  const customersById = new Map(ds.customers.map((c) => [c.customer_id, c]));
  const paymentsByInvoice = groupBy(ds.payments, (p) => p.invoice_id ?? '');
  const paymentsByCustomer = groupBy(ds.payments, (p) => p.customer_id);
  const activitiesByInvoice = groupBy(ds.activities, (a) => a.invoice_id ?? '');
  const activitiesByCustomer = groupBy(ds.activities, (a) => a.customer_id);
  const prevInvoiceState = new Map((prev?.invoice_state ?? []).map((s) => [s.invoice_id, s]));
  const prevCustomers = new Map((prev?.customers ?? []).map((c) => [c.customer_id, c]));

  // ---------- 1. Invoices ----------
  const invoices: CalculatedInvoice[] = [];
  let unappliedCash = 0;
  let creditNotesApplied = 0;
  for (const inv of ds.invoices) {
    const cust = customersById.get(inv.customer_id);
    const closed = CLOSED_STATUSES.has(inv.invoice_status) || inv.cancellation_status === 'CANCELLED';
    // Recompute outstanding from components so that credit notes / partial payments cannot distort totals.
    let outstanding = closed ? 0 : round2(inv.original_amount - inv.paid_amount - inv.credit_note_amount);
    if (outstanding < 0) {
      // Overpayment => the negative part is unapplied cash, not negative receivable.
      const over = convert(-outstanding, inv.invoice_currency, ds.fx);
      if (over) unappliedCash += over.value;
      outstanding = 0;
    }
    if (!closed) {
      const cn = convert(inv.credit_note_amount, inv.invoice_currency, ds.fx);
      if (cn) creditNotesApplied += cn.value;
    }
    const conv = convert(outstanding, inv.invoice_currency, ds.fx);
    if (!conv && outstanding > 0) {
      issues.push({ severity: 'warning', code: 'MISSING_FX_RATE', entity: 'fx', entity_id: inv.invoice_id, message: `No FX rate for ${inv.invoice_currency}; invoice excluded from reporting totals` });
    }
    const aging = outstanding > 0 ? agingDays(ref, inv.due_date) : inv.due_date ? agingDays(ref, inv.due_date) : null;
    const disputed = Math.min(inv.disputed_amount, outstanding);
    const disputedConv = convert(disputed, inv.invoice_currency, ds.fx);
    const invActivities = (activitiesByInvoice.get(inv.invoice_id) ?? []).slice().sort((a, b) => a.activity_date.localeCompare(b.activity_date));
    const openPromise = invActivities.filter((a) => a.promised_payment_date && !a.completed).slice(-1)[0];
    const nextAction = invActivities.filter((a) => a.next_action && !a.completed).slice(-1)[0];
    invoices.push({
      ...inv,
      outstanding_amount: outstanding,
      aging_days: aging,
      aging_bucket: outstanding > 0 ? bucketFor(aging) : aging === null ? 'UNKNOWN' : 'CURRENT',
      is_overdue: outstanding > 0 && aging !== null && aging > 0,
      outstanding_reporting: conv?.value ?? 0,
      disputed_reporting: disputedConv?.value ?? 0,
      exchange_rate: conv?.rate ?? null,
      exchange_rate_date: conv?.rate_date ?? null,
      customer_name: cust?.customer_name ?? inv.customer_id,
      account_owner_name: cust?.account_owner_name ?? 'Unassigned',
      country: cust?.country ?? 'Unknown',
      promised_payment_date: openPromise?.promised_payment_date ?? null,
      next_action: nextAction?.next_action ?? null,
      next_action_date: nextAction?.next_action_date ?? null,
      owner: cust?.account_owner_name ?? 'Unassigned',
      payments: (paymentsByInvoice.get(inv.invoice_id) ?? []).slice().sort((a, b) => a.payment_date.localeCompare(b.payment_date)),
      activities: invActivities,
    });
  }
  // Unapplied cash from payments not linked to any invoice (or partially applied)
  for (const p of ds.payments) {
    if (p.reconciliation_status === 'REFUNDED') continue;
    if (p.unapplied_amount > 0) {
      const c = convert(p.unapplied_amount, p.payment_currency, ds.fx);
      if (c) unappliedCash += c.value;
    }
  }

  const open = invoices.filter((i) => i.outstanding_amount > 0);

  // ---------- 2. Week-level flows ----------
  let collectedThisWeek = 0;
  for (const p of ds.payments) {
    if (p.reconciliation_status === 'REFUNDED') continue;
    if (inRange(p.payment_date, week.start, week.end)) {
      const c = convert(p.applied_amount, p.payment_currency, ds.fx);
      if (c) collectedThisWeek += c.value;
    }
  }
  let newOverdue = 0;
  let resolvedOverdue = 0;
  const overdueNowById = new Map(open.filter((i) => i.is_overdue).map((i) => [i.invoice_id, i]));
  if (prev) {
    for (const i of overdueNowById.values()) {
      const before = prevInvoiceState.get(i.invoice_id);
      if (!before || !before.is_overdue) newOverdue += i.outstanding_reporting; // became overdue (or is new and already overdue)
    }
    for (const s of prev.invoice_state) {
      if (!s.is_overdue) continue;
      const now = invoices.find((i) => i.invoice_id === s.invoice_id);
      const remaining = now && now.is_overdue ? now.outstanding_reporting : 0;
      if (s.outstanding_reporting > remaining) resolvedOverdue += s.outstanding_reporting - remaining;
    }
  } else {
    // Without a prior snapshot, "new overdue this week" is approximated by invoices whose due date fell inside the week.
    for (const i of overdueNowById.values()) if (i.due_date && inRange(i.due_date, week.start, week.end)) newOverdue += i.outstanding_reporting;
  }

  // ---------- 3. Customers ----------
  const customers: CustomerRisk[] = [];
  for (const c of ds.customers) {
    const cInv = open.filter((i) => i.customer_id === c.customer_id);
    const allInv = invoices.filter((i) => i.customer_id === c.customer_id);
    const buckets = emptyBuckets();
    let total = 0,
      overdue = 0,
      over30 = 0,
      over90 = 0,
      disputed = 0,
      maxAging = 0;
    for (const i of cInv) {
      total += i.outstanding_reporting;
      disputed += i.disputed_reporting;
      if (i.aging_bucket !== 'UNKNOWN') buckets[i.aging_bucket] += i.outstanding_reporting;
      if (i.is_overdue) {
        overdue += i.outstanding_reporting;
        maxAging = Math.max(maxAging, i.aging_days ?? 0);
        if ((i.aging_days ?? 0) > 30) over30 += i.outstanding_reporting;
        if ((i.aging_days ?? 0) > 90) over90 += i.outstanding_reporting;
      }
    }
    const pays = paymentsByCustomer.get(c.customer_id) ?? [];
    const lastPayment = pays.filter((p) => p.reconciliation_status !== 'REFUNDED').map((p) => p.payment_date).sort().slice(-1)[0] ?? null;
    const acts = activitiesByCustomer.get(c.customer_id) ?? [];
    const lastActivity = acts.map((a) => a.activity_date).sort().slice(-1)[0] ?? null;
    const promise = evaluatePromises(acts, pays, ref, ds, c);
    const creditLimitConv = c.credit_limit !== null ? convert(c.credit_limit, c.contract_currency, ds.fx) : null;
    const creditLimit = creditLimitConv?.value ?? null;
    const utilization = creditLimit && creditLimit > 0 ? total / creditLimit : null;
    const prevRow = prevCustomers.get(c.customer_id);
    const prevOverdue = prev ? (prevRow?.overdue ?? 0) : null;
    const prevTotal = prev ? (prevRow?.total_outstanding ?? 0) : null;
    const risk = computeRiskScore(
      {
        overdue_reporting: overdue,
        total_outstanding_reporting: total,
        overdue_30_plus_reporting: over30,
        max_aging_days: maxAging,
        previous_overdue_reporting: prevOverdue,
        broken_promise_amount_reporting: promise.broken_amount,
        credit_utilization: utilization,
        days_since_last_activity: lastActivity ? daysBetween(lastActivity, ref) : null,
        disputed_reporting: disputed,
        reporting_currency: rc,
        credit_status: c.credit_status,
      },
      riskCfg,
    );
    const dq: DataQualityIssue[] = [];
    if (c.credit_limit === null) dq.push({ severity: 'info', code: 'MISSING_CREDIT_LIMIT', entity: 'customer', entity_id: c.customer_id, message: 'No credit limit on file' });
    if (!c.account_owner_id) dq.push({ severity: 'warning', code: 'MISSING_OWNER', entity: 'customer', entity_id: c.customer_id, message: 'No account owner assigned' });
    for (const i of allInv) if (!i.due_date && i.outstanding_amount > 0) dq.push({ severity: 'warning', code: 'MISSING_DUE_DATE', entity: 'invoice', entity_id: i.invoice_id, message: `Invoice ${i.invoice_number} has no due date` });

    customers.push({
      customer_id: c.customer_id,
      customer_name: c.customer_name,
      country: c.country,
      region: c.region,
      account_owner_id: c.account_owner_id,
      account_owner_name: c.account_owner_name || 'Unassigned',
      contract_currency: c.contract_currency,
      total_outstanding_reporting: round2(total),
      overdue_reporting: round2(overdue),
      not_due_reporting: round2(total - overdue),
      overdue_30_plus_reporting: round2(over30),
      overdue_90_plus_reporting: round2(over90),
      disputed_reporting: round2(disputed),
      max_aging_days: maxAging,
      invoice_count: cInv.length,
      overdue_invoice_count: cInv.filter((i) => i.is_overdue).length,
      credit_limit_reporting: creditLimit,
      credit_utilization: utilization,
      credit_limit_exceeded: utilization !== null && utilization > 1,
      last_payment_date: lastPayment,
      last_activity_date: lastActivity,
      next_promise_date: promise.next_date,
      next_promise_amount_reporting: promise.next_amount,
      promise_broken: promise.broken_amount > 0,
      broken_promise_amount_reporting: round2(promise.broken_amount),
      wow_overdue_change_reporting: prevOverdue === null ? null : round2(overdue - prevOverdue),
      wow_total_change_reporting: prevTotal === null ? null : round2(total - prevTotal),
      risk,
      recommended_action: recommendAction({ overdue, over30, over90, maxAging, promiseBroken: promise.broken_amount > 0, disputed, creditExceeded: utilization !== null && utilization > 1, grade: risk.grade, total }),
      bucket_totals: buckets,
      data_quality: dq,
      credit_status: c.credit_status,
      collection_status: c.collection_status,
    });
  }

  // ---------- 4. Totals ----------
  const total = sum(open.map((i) => i.outstanding_reporting));
  const overdueInv = open.filter((i) => i.is_overdue);
  const overdue = sum(overdueInv.map((i) => i.outstanding_reporting));
  const over30 = sum(overdueInv.filter((i) => (i.aging_days ?? 0) > 30).map((i) => i.outstanding_reporting));
  const over90 = sum(overdueInv.filter((i) => (i.aging_days ?? 0) > 90).map((i) => i.outstanding_reporting));
  const disputedTotal = sum(open.map((i) => i.disputed_reporting));
  const dueWithin7 = sum(open.filter((i) => !i.is_overdue && i.due_date && daysBetween(ref, i.due_date) <= 7 && daysBetween(ref, i.due_date) >= 0).map((i) => i.outstanding_reporting));
  const brokenCustomers = customers.filter((c) => c.promise_broken);
  const brokenAmount = sum(brokenCustomers.map((c) => c.broken_promise_amount_reporting));
  // At-risk = union of: 30+ overdue invoices, disputed invoices, invoices of customers with broken promises or credit limit exceeded.
  const atRiskCustomers = new Set(customers.filter((c) => c.promise_broken || c.credit_limit_exceeded).map((c) => c.customer_id));
  const atRisk = sum(open.filter((i) => (i.is_overdue && (i.aging_days ?? 0) > 30) || i.disputed_reporting > 0 || atRiskCustomers.has(i.customer_id)).map((i) => i.outstanding_reporting));

  const bucketTotals = emptyBuckets();
  for (const i of open) if (i.aging_bucket !== 'UNKNOWN') bucketTotals[i.aging_bucket] += i.outstanding_reporting;

  const totals = {
    total_outstanding: round2(total),
    overdue_outstanding: round2(overdue),
    not_yet_due: round2(total - overdue),
    overdue_30_plus: round2(over30),
    overdue_90_plus: round2(over90),
    disputed: round2(disputedTotal),
    unapplied_cash: round2(unappliedCash),
    credit_notes_applied: round2(creditNotesApplied),
    collected_during_week: round2(collectedThisWeek),
    new_overdue_during_week: round2(newOverdue),
    resolved_overdue_during_week: round2(resolvedOverdue),
    due_within_7_days: round2(dueWithin7),
    broken_promise_amount: round2(brokenAmount),
    broken_promise_count: brokenCustomers.length,
    at_risk_amount: round2(atRisk),
    invoice_count: open.length,
    customer_count: customers.filter((c) => c.total_outstanding_reporting > 0).length,
  };

  // ---------- 5. Dimensions ----------
  const byCountry = dimension(open, customers, (c) => c.country, (c) => c.country, prev?.countries ?? null);
  const byOwner = dimension(open, customers, (c) => c.account_owner_id || 'unassigned', (c) => c.account_owner_name || 'Unassigned', prev?.owners ?? null);
  const byCustomer = dimension(open, customers, (c) => c.customer_id, (c) => c.customer_name, prev ? prev.customers.map((c) => ({ key: c.customer_id, label: c.customer_name, total_outstanding: c.total_outstanding, overdue: c.overdue })) : null);
  const byCurrency = dimensionByInvoice(open, (i) => i.invoice_currency, prev?.currencies ?? null);

  // ---------- 6. FX effect ----------
  let fxEffect: number | null = null;
  if (prev) {
    fxEffect = 0;
    const prevRates = new Map(prev.fx.rates.map((r) => [r.currency, r.rate_to_reporting]));
    prevRates.set(prev.reporting_currency, 1);
    for (const s of prev.invoice_state) {
      const now = invoices.find((i) => i.invoice_id === s.invoice_id);
      if (!now || now.outstanding_amount <= 0 || now.exchange_rate === null) continue;
      const rPrev = prevRates.get(s.invoice_currency);
      if (rPrev === undefined) continue;
      // FX effect is measured on the balance that existed last week and still exists (min of both).
      const base = Math.min(s.outstanding_original, now.outstanding_amount);
      fxEffect += base * (now.exchange_rate - rPrev);
    }
    fxEffect = round2(fxEffect);
  }

  // ---------- 7. Snapshot ----------
  const snapshot: Snapshot = {
    snapshot_id: ref,
    snapshot_date: ref,
    as_of: ds.as_of,
    reporting_currency: rc,
    fx: ds.fx,
    source: ds.source,
    totals,
    bucket_totals: mapValues(bucketTotals, round2),
    customers: customers.map<SnapshotCustomerRow>((c) => ({
      customer_id: c.customer_id,
      customer_name: c.customer_name,
      total_outstanding: c.total_outstanding_reporting,
      overdue: c.overdue_reporting,
      overdue_30_plus: c.overdue_30_plus_reporting,
      max_aging_days: c.max_aging_days,
      risk_score: c.risk.score,
      risk_grade: c.risk.grade,
    })),
    owners: byOwner.map(toDimRow),
    countries: byCountry.map(toDimRow),
    currencies: byCurrency.map(toDimRow),
    invoice_state: open.map<SnapshotInvoiceState>((i) => ({
      invoice_id: i.invoice_id,
      customer_id: i.customer_id,
      outstanding_reporting: i.outstanding_reporting,
      outstanding_original: i.outstanding_amount,
      invoice_currency: i.invoice_currency,
      is_overdue: i.is_overdue,
    })),
  };

  const kpis = buildKpis(totals, prev?.totals ?? null, rc);
  const actions = buildActions(invoices, customers, ref, rc);
  const totalOpen = total || 1;

  return {
    as_of: ds.as_of,
    reference_date: ref,
    previous_snapshot_date: prev?.snapshot_date ?? null,
    reporting_currency: rc,
    source: ds.source,
    is_mock: ds.source === 'mock',
    kpis,
    invoices,
    customers: customers.sort((a, b) => b.risk.score - a.risk.score || b.overdue_reporting - a.overdue_reporting),
    aging_by_bucket: AGING_BUCKETS.map((b) => ({ bucket: b, amount: round2(bucketTotals[b]), share: round2((bucketTotals[b] / totalOpen) * 10000) / 10000, previous: prev ? prev.bucket_totals[b] : null })),
    aging_by_country: byCountry,
    aging_by_owner: byOwner,
    aging_by_customer: byCustomer,
    aging_by_currency: byCurrency,
    actions,
    snapshot,
    data_quality: dedupeIssues(issues),
    completeness: ds.completeness,
    fx: ds.fx,
    week,
    fx_effect_reporting: fxEffect,
    unknown_due_reporting: sum(open.filter((i) => i.aging_bucket === 'UNKNOWN').map((i) => i.outstanding_reporting)),
  };
}

// ---------- helpers ----------

function evaluatePromises(acts: CollectionActivity[], pays: Payment[], ref: ISODate, ds: ReceivablesDataset, c: Customer) {
  let broken = 0;
  let nextDate: ISODate | null = null;
  let nextAmount: number | null = null;
  for (const a of acts) {
    if (!a.promised_payment_date || a.completed) continue;
    const promisedConv = a.promised_payment_amount !== null ? convert(a.promised_payment_amount, a.promised_currency ?? c.contract_currency, ds.fx) : null;
    const promised = promisedConv?.value ?? 0;
    if (a.promised_payment_date < ref) {
      // Promise date passed: compare applied payments received since the promise was made (>= activity_date) until reference.
      const received = sum(
        pays
          .filter((p) => p.reconciliation_status !== 'REFUNDED' && p.payment_date >= a.activity_date && p.payment_date <= ref)
          .map((p) => convert(p.applied_amount, p.payment_currency, ds.fx)?.value ?? 0),
      );
      if (received + 0.01 < promised) broken += promised - received;
    } else if (!nextDate || a.promised_payment_date < nextDate) {
      nextDate = a.promised_payment_date;
      nextAmount = promised || null;
    }
  }
  return { broken_amount: round2(broken), next_date: nextDate, next_amount: nextAmount };
}

function recommendAction(x: { overdue: number; over30: number; over90: number; maxAging: number; promiseBroken: boolean; disputed: number; creditExceeded: boolean; grade: string; total: number }): string {
  if (x.over90 > 0) return 'Escalate to Finance leader; evaluate credit hold and legal/collection agency path';
  if (x.promiseBroken) return 'Re-confirm payment date with customer today; escalate to Sales leader if no confirmation within 2 business days';
  if (x.creditExceeded) return 'Credit limit exceeded: hold new bookings until balance is below limit or Finance approves exception';
  if (x.over30 > 0) return 'Send formal overdue notice and call decision maker this week; request payment plan';
  if (x.disputed > 0) return 'Resolve dispute with Operations/Finance; agree undisputed portion to be paid now';
  if (x.overdue > 0) return 'Send payment reminder and confirm remittance date';
  if (x.total > 0) return 'No action required; monitor upcoming due dates';
  return 'No open balance';
}

function dimension(open: CalculatedInvoice[], customers: CustomerRisk[], keyOf: (c: CustomerRisk) => string, labelOf: (c: CustomerRisk) => string, prevRows: SnapshotDimensionRow[] | null): DimensionAging[] {
  const custMap = new Map(customers.map((c) => [c.customer_id, c]));
  const map = new Map<string, DimensionAging>();
  for (const i of open) {
    const c = custMap.get(i.customer_id);
    if (!c) continue;
    const key = keyOf(c);
    let row = map.get(key);
    if (!row) {
      row = { key, label: labelOf(c), total: 0, overdue: 0, buckets: emptyBuckets(), previous_overdue: prevRows ? (prevRows.find((r) => r.key === key)?.overdue ?? 0) : null };
      map.set(key, row);
    }
    row.total = round2(row.total + i.outstanding_reporting);
    if (i.is_overdue) row.overdue = round2(row.overdue + i.outstanding_reporting);
    if (i.aging_bucket !== 'UNKNOWN') row.buckets[i.aging_bucket] = round2(row.buckets[i.aging_bucket] + i.outstanding_reporting);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

function dimensionByInvoice(open: CalculatedInvoice[], keyOf: (i: CalculatedInvoice) => string, prevRows: SnapshotDimensionRow[] | null): DimensionAging[] {
  const map = new Map<string, DimensionAging>();
  for (const i of open) {
    const key = keyOf(i);
    let row = map.get(key);
    if (!row) {
      row = { key, label: key, total: 0, overdue: 0, buckets: emptyBuckets(), previous_overdue: prevRows ? (prevRows.find((r) => r.key === key)?.overdue ?? 0) : null };
      map.set(key, row);
    }
    row.total = round2(row.total + i.outstanding_reporting);
    if (i.is_overdue) row.overdue = round2(row.overdue + i.outstanding_reporting);
    if (i.aging_bucket !== 'UNKNOWN') row.buckets[i.aging_bucket] = round2(row.buckets[i.aging_bucket] + i.outstanding_reporting);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

const toDimRow = (d: DimensionAging): SnapshotDimensionRow => ({ key: d.key, label: d.label, total_outstanding: d.total, overdue: d.overdue });

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of arr) {
    const k = key(t);
    const list = m.get(k);
    if (list) list.push(t);
    else m.set(k, [t]);
  }
  return m;
}

function sum(xs: number[]): number {
  return round2(xs.reduce((a, b) => a + b, 0));
}

function mapValues(rec: Record<AgingBucket, number>, f: (n: number) => number): Record<AgingBucket, number> {
  const out = emptyBuckets();
  for (const k of AGING_BUCKETS) out[k] = f(rec[k]);
  return out;
}

function dedupeIssues(issues: DataQualityIssue[]): DataQualityIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}|${i.entity}|${i.entity_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export { addDays };

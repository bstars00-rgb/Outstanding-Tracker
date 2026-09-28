import { daysBetween, inRange } from '@core/dates';
import type { CalculatedInvoice, KpiKey, TrackerModel } from '@core/types';

/**
 * KPI drill-down: every KPI card links to the rows it was computed from. The predicates mirror the
 * definitions in src/core/calc.ts so the filtered sum equals the card value (new_overdue_this_week is
 * approximated by "became overdue since the report week started" when the previous snapshot state is
 * not part of the published model).
 */
export const INVOICE_KPIS: KpiKey[] = ['total_outstanding', 'overdue_outstanding', 'overdue_ratio', 'due_within_7_days', 'collected_this_week', 'new_overdue_this_week', 'overdue_30_plus', 'overdue_90_plus', 'at_risk_amount'];

export function kpiDrilldownPath(key: KpiKey): string {
  if (key === 'broken_promises') return `/customers?kpi=${key}`;
  return `/invoices?kpi=${key}`;
}

export function isInvoiceKpi(key: string): key is KpiKey {
  return (INVOICE_KPIS as string[]).includes(key);
}

export function kpiInvoicePredicate(key: string, m: TrackerModel): ((i: CalculatedInvoice) => boolean) | null {
  const ref = m.reference_date;
  const week = m.week;
  const atRiskCustomers = new Set(m.customers.filter((c) => c.promise_broken || c.credit_limit_exceeded).map((c) => c.customer_id));
  const open = (i: CalculatedInvoice) => i.outstanding_amount > 0;
  switch (key) {
    case 'total_outstanding':
      return open;
    case 'overdue_outstanding':
    case 'overdue_ratio':
      return (i) => open(i) && i.is_overdue;
    case 'due_within_7_days':
      return (i) => open(i) && !i.is_overdue && !!i.due_date && daysBetween(ref, i.due_date) >= 0 && daysBetween(ref, i.due_date) <= 7;
    case 'collected_this_week':
      return (i) => i.payments.some((p) => p.reconciliation_status !== 'REFUNDED' && inRange(p.payment_date, week.start, week.end));
    case 'new_overdue_this_week':
      return (i) => open(i) && i.is_overdue && !!i.due_date && (m.previous_snapshot_date ? i.due_date >= week.start : inRange(i.due_date, week.start, week.end));
    case 'overdue_30_plus':
      return (i) => open(i) && i.is_overdue && (i.aging_days ?? 0) > 30;
    case 'overdue_90_plus':
      return (i) => open(i) && i.is_overdue && (i.aging_days ?? 0) > 90;
    case 'at_risk_amount':
      return (i) => open(i) && ((i.is_overdue && (i.aging_days ?? 0) > 30) || i.disputed_reporting > 0 || atRiskCustomers.has(i.customer_id));
    default:
      return null;
  }
}

/** Amount the drill-down rows represent for the KPI (outstanding, or payments applied this week). */
export function kpiRowAmount(key: string, i: CalculatedInvoice, m: TrackerModel): number {
  if (key === 'collected_this_week') {
    return i.payments
      .filter((p) => p.reconciliation_status !== 'REFUNDED' && inRange(p.payment_date, m.week.start, m.week.end))
      .reduce((s, p) => s + (p.applied_amount * (i.exchange_rate ?? 1)), 0);
  }
  return i.outstanding_reporting;
}

import { formatMoney, formatPct, round2 } from './money';
import type { KpiValue, SnapshotTotals } from './types';

type Status = KpiValue['status'];

function change(cur: number, prev: number | null): { change: number | null; change_pct: number | null } {
  if (prev === null) return { change: null, change_pct: null };
  const c = round2(cur - prev);
  const pct = prev !== 0 ? round2((c / Math.abs(prev)) * 10000) / 10000 : cur !== 0 ? null : 0;
  return { change: c, change_pct: pct };
}

/**
 * KPI status is a combination of level and direction, not raw size:
 *  - ratios use absolute thresholds
 *  - amounts are judged by their share of total outstanding and by WoW movement
 */
export function buildKpis(t: SnapshotTotals, prev: SnapshotTotals | null, ccy: string): KpiValue[] {
  const total = t.total_outstanding || 1;
  const overdueRatio = t.total_outstanding > 0 ? t.overdue_outstanding / t.total_outstanding : 0;
  const prevRatio = prev && prev.total_outstanding > 0 ? prev.overdue_outstanding / prev.total_outstanding : null;

  const moneyDelta = (cur: number, p: number | null) => {
    const ch = change(cur, p);
    return ch.change === null ? 'No prior week to compare' : `${formatMoney(ch.change, ccy, { signed: true, compact: true })} (${formatPct(ch.change_pct, { signed: true })}) vs last week`;
  };

  const worseIfUp = (cur: number, p: number | null, shareWarn: number, shareCrit: number): Status => {
    const share = cur / total;
    const ch = change(cur, p).change_pct;
    if (share >= shareCrit || (ch !== null && ch > 0.25 && share >= shareWarn)) return 'critical';
    if (share >= shareWarn || (ch !== null && ch > 0.1)) return 'warning';
    if (cur === 0 || (ch !== null && ch < 0)) return 'good';
    return 'neutral';
  };

  const kpis: KpiValue[] = [];
  kpis.push({
    key: 'total_outstanding',
    label: 'Total Outstanding',
    value: t.total_outstanding,
    unit: 'currency',
    previous: prev?.total_outstanding ?? null,
    ...change(t.total_outstanding, prev?.total_outstanding ?? null),
    status: 'neutral',
    interpretation: `${t.invoice_count} open invoices across ${t.customer_count} customers. ${moneyDelta(t.total_outstanding, prev?.total_outstanding ?? null)}`,
    definition: 'Sum of outstanding_amount of all unsettled invoices (excluding cancelled and written-off), converted to reporting currency.',
  });
  kpis.push({
    key: 'overdue_outstanding',
    label: 'Overdue Outstanding',
    value: t.overdue_outstanding,
    unit: 'currency',
    previous: prev?.overdue_outstanding ?? null,
    ...change(t.overdue_outstanding, prev?.overdue_outstanding ?? null),
    status: worseIfUp(t.overdue_outstanding, prev?.overdue_outstanding ?? null, 0.2, 0.35),
    interpretation: `${formatPct(overdueRatio)} of total is past due. ${moneyDelta(t.overdue_outstanding, prev?.overdue_outstanding ?? null)}`,
    definition: 'Outstanding where due_date < reference date and outstanding_amount > 0.',
  });
  kpis.push({
    key: 'overdue_ratio',
    label: 'Overdue Ratio',
    value: round2(overdueRatio * 10000) / 10000,
    unit: 'ratio',
    previous: prevRatio,
    ...change(overdueRatio, prevRatio),
    status: overdueRatio >= 0.35 ? 'critical' : overdueRatio >= 0.2 ? 'warning' : overdueRatio === 0 ? 'good' : 'neutral',
    interpretation: prevRatio === null ? 'No prior week to compare' : `${overdueRatio > prevRatio ? 'Up' : overdueRatio < prevRatio ? 'Down' : 'Flat'} from ${formatPct(prevRatio)} last week`,
    definition: 'Overdue Outstanding / Total Outstanding.',
  });
  kpis.push({
    key: 'due_within_7_days',
    label: 'Due Within 7 Days',
    value: t.due_within_7_days,
    unit: 'currency',
    previous: prev?.due_within_7_days ?? null,
    ...change(t.due_within_7_days, prev?.due_within_7_days ?? null),
    status: 'neutral',
    interpretation: 'Not yet due; must be collected next week to avoid new overdue',
    definition: 'Outstanding of invoices not yet overdue whose due_date is within the next 7 days.',
  });
  kpis.push({
    key: 'collected_this_week',
    label: 'Collected This Week',
    value: t.collected_during_week,
    unit: 'currency',
    previous: prev?.collected_during_week ?? null,
    ...change(t.collected_during_week, prev?.collected_during_week ?? null),
    status: t.collected_during_week > 0 ? 'good' : 'warning',
    interpretation: `Applied cash received in the report week. ${moneyDelta(t.collected_during_week, prev?.collected_during_week ?? null)}`,
    definition: 'Sum of applied_amount of payments dated inside the report week (unapplied cash excluded).',
  });
  kpis.push({
    key: 'new_overdue_this_week',
    label: 'New Overdue This Week',
    value: t.new_overdue_during_week,
    unit: 'currency',
    previous: prev?.new_overdue_during_week ?? null,
    ...change(t.new_overdue_during_week, prev?.new_overdue_during_week ?? null),
    status: t.new_overdue_during_week === 0 ? 'good' : t.new_overdue_during_week / total > 0.1 ? 'critical' : 'warning',
    interpretation: `Resolved overdue this week: ${formatMoney(t.resolved_overdue_during_week, ccy, { compact: true })}`,
    definition: 'Outstanding of invoices that were not overdue in the previous snapshot and are overdue now.',
  });
  kpis.push({
    key: 'overdue_30_plus',
    label: '30+ Days Overdue',
    value: t.overdue_30_plus,
    unit: 'currency',
    previous: prev?.overdue_30_plus ?? null,
    ...change(t.overdue_30_plus, prev?.overdue_30_plus ?? null),
    status: worseIfUp(t.overdue_30_plus, prev?.overdue_30_plus ?? null, 0.1, 0.2),
    interpretation: moneyDelta(t.overdue_30_plus, prev?.overdue_30_plus ?? null),
    definition: 'Outstanding with aging_days > 30.',
  });
  kpis.push({
    key: 'overdue_90_plus',
    label: '90+ Days Overdue',
    value: t.overdue_90_plus,
    unit: 'currency',
    previous: prev?.overdue_90_plus ?? null,
    ...change(t.overdue_90_plus, prev?.overdue_90_plus ?? null),
    status: t.overdue_90_plus === 0 ? 'good' : worseIfUp(t.overdue_90_plus, prev?.overdue_90_plus ?? null, 0.03, 0.08),
    interpretation: t.overdue_90_plus > 0 ? 'Candidates for credit hold / escalation' : 'No balance older than 90 days',
    definition: 'Outstanding with aging_days > 90.',
  });
  kpis.push({
    key: 'broken_promises',
    label: 'Broken Promises',
    value: t.broken_promise_amount,
    unit: 'currency',
    previous: prev?.broken_promise_amount ?? null,
    ...change(t.broken_promise_amount, prev?.broken_promise_amount ?? null),
    status: t.broken_promise_count === 0 ? 'good' : t.broken_promise_count >= 3 ? 'critical' : 'warning',
    interpretation: `${t.broken_promise_count} customer(s) missed a promised payment date`,
    definition: 'Promised amount not received by the promised_payment_date (uncompleted promise activities).',
  });
  kpis.push({
    key: 'at_risk_amount',
    label: 'At-Risk Amount',
    value: t.at_risk_amount,
    unit: 'currency',
    previous: prev?.at_risk_amount ?? null,
    ...change(t.at_risk_amount, prev?.at_risk_amount ?? null),
    status: worseIfUp(t.at_risk_amount, prev?.at_risk_amount ?? null, 0.15, 0.3),
    interpretation: `${formatPct(t.at_risk_amount / total)} of total outstanding. Disputed: ${formatMoney(t.disputed, ccy, { compact: true })}`,
    definition: 'Union of: 30+ days overdue, disputed invoices, and all open invoices of customers with a broken promise or an exceeded credit limit.',
  });
  return kpis;
}

import { addDays } from '@core/dates';
import { round2 } from '@core/money';
import type { CustomerRisk, TrackerModel } from '@core/types';
import type { CustomerFact, InsightInput } from './types';

const fact = (c: CustomerRisk): CustomerFact => ({
  customer: c.customer_name,
  country: c.country,
  owner: c.account_owner_name,
  total: c.total_outstanding_reporting,
  overdue: c.overdue_reporting,
  overdue_30_plus: c.overdue_30_plus_reporting,
  max_aging_days: c.max_aging_days,
  wow_overdue_change: c.wow_overdue_change_reporting,
  risk_score: c.risk.score,
  risk_grade: c.risk.grade,
  risk_reasons: c.risk.factors.filter((f) => f.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((f) => f.evidence),
  promise_date: c.next_promise_date,
  broken_promise_amount: c.broken_promise_amount_reporting,
  credit_utilization: c.credit_utilization,
  disputed: c.disputed_reporting,
  last_payment_date: c.last_payment_date,
  recommended_action: c.recommended_action,
});

/** Build the structured, number-only input for the AI from the calculated model. No PII, no invoice detail. */
export function buildInsightInput(m: TrackerModel): InsightInput {
  const withBalance = m.customers.filter((c) => c.total_outstanding_reporting > 0);
  const nextWeekEnd = addDays(m.reference_date, 7);
  const dueNextWeek = m.invoices
    .filter((i) => i.outstanding_amount > 0 && !i.is_overdue && i.due_date && i.due_date > m.reference_date && i.due_date <= nextWeekEnd)
    .map((i) => ({ customer: i.customer_name, owner: i.account_owner_name, amount: i.outstanding_reporting, due_date: i.due_date! }))
    .sort((a, b) => b.amount - a.amount);
  const promisedNextWeek = round2(withBalance.filter((c) => c.next_promise_date && c.next_promise_date <= nextWeekEnd).reduce((s, c) => s + (c.next_promise_amount_reporting ?? 0), 0));

  const owners = new Map<string, InsightInput['by_owner'][number]>();
  for (const c of withBalance) {
    const o = owners.get(c.account_owner_name) ?? { owner: c.account_owner_name, total: 0, overdue: 0, previous_overdue: null, customers_overdue: 0, broken_promises: 0 };
    o.total = round2(o.total + c.total_outstanding_reporting);
    o.overdue = round2(o.overdue + c.overdue_reporting);
    if (c.overdue_reporting > 0) o.customers_overdue++;
    if (c.promise_broken) o.broken_promises++;
    owners.set(c.account_owner_name, o);
  }
  for (const d of m.aging_by_owner) {
    const o = owners.get(d.label);
    if (o) o.previous_overdue = d.previous_overdue;
  }

  const dq = new Map<string, { count: number; sample: string }>();
  for (const i of m.data_quality) {
    const e = dq.get(i.code) ?? { count: 0, sample: i.message };
    e.count++;
    dq.set(i.code, e);
  }

  const activityCutoff = m.week.start;
  const recentActivities = m.invoices.flatMap((i) => i.activities).filter((a) => a.activity_date >= activityCutoff).length;

  return {
    report_date: m.reference_date,
    previous_snapshot_date: m.previous_snapshot_date,
    reporting_currency: m.reporting_currency,
    is_mock: m.is_mock,
    kpis: m.kpis.map((k) => ({ key: k.key, label: k.label, value: k.value, previous: k.previous, change: k.change, change_pct: k.change_pct, unit: k.unit })),
    fx_effect_reporting: m.fx_effect_reporting,
    top_overdue_customers: withBalance.filter((c) => c.overdue_reporting > 0).sort((a, b) => b.overdue_reporting - a.overdue_reporting).slice(0, 8).map(fact),
    new_overdue_customers: withBalance.filter((c) => (c.wow_overdue_change_reporting ?? 0) > 0).sort((a, b) => (b.wow_overdue_change_reporting ?? 0) - (a.wow_overdue_change_reporting ?? 0)).slice(0, 8).map(fact),
    improved_customers: withBalance.filter((c) => (c.wow_overdue_change_reporting ?? 0) < 0).sort((a, b) => (a.wow_overdue_change_reporting ?? 0) - (b.wow_overdue_change_reporting ?? 0)).slice(0, 5).map(fact),
    broken_promises: withBalance.filter((c) => c.promise_broken).map(fact),
    credit_limit_exceeded: withBalance.filter((c) => c.credit_limit_exceeded).map(fact),
    disputes: withBalance.filter((c) => c.disputed_reporting > 0).map(fact),
    collection_opportunities: withBalance
      .filter((c) => c.overdue_reporting > 0 && c.max_aging_days <= 30 && !c.promise_broken && c.disputed_reporting === 0 && (c.last_payment_date !== null || c.next_promise_date !== null))
      .sort((a, b) => b.overdue_reporting - a.overdue_reporting)
      .slice(0, 5)
      .map(fact),
    by_owner: [...owners.values()].sort((a, b) => b.overdue - a.overdue),
    by_country: m.aging_by_country.map((d) => ({ country: d.label, total: d.total, overdue: d.overdue, previous_overdue: d.previous_overdue })),
    due_next_week: dueNextWeek.slice(0, 10),
    due_next_week_total: round2(dueNextWeek.reduce((s, d) => s + d.amount, 0)),
    promised_next_week_total: promisedNextWeek,
    recent_activity_count: recentActivities,
    data_quality: [...dq.entries()].map(([code, e]) => ({ code, count: e.count, sample: e.sample })),
    completeness: m.completeness,
  };
}

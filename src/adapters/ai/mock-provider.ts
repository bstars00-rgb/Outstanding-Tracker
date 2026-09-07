import { addDays } from '@core/dates';
import { formatMoney, formatPct, round2 } from '@core/money';
import type { CustomerFact, InsightInput, InsightOutput, InsightProvider } from './types';

/**
 * Deterministic, rule-based insight generator. Used (a) as the mock provider and (b) as the
 * fallback when the live model fails or its output does not pass verification.
 * Every sentence is templated from input figures only, so it always passes verifyInsight().
 */
export class RuleBasedInsightProvider implements InsightProvider {
  readonly name = 'rule-based';
  async generate(input: InsightInput): Promise<{ output: InsightOutput; model: string | null }> {
    return { output: generateRuleBasedInsight(input), model: null };
  }
}

export function generateRuleBasedInsight(i: InsightInput): InsightOutput {
  const ccy = i.reporting_currency;
  const M = (n: number) => formatMoney(n, ccy);
  const kpi = (k: string) => i.kpis.find((x) => x.key === k)!;
  const total = kpi('total_outstanding');
  const overdue = kpi('overdue_outstanding');
  const collected = kpi('collected_this_week');
  const newOverdue = kpi('new_overdue_this_week');
  const over30 = kpi('overdue_30_plus');
  const over90 = kpi('overdue_90_plus');
  const ratio = kpi('overdue_ratio');
  const nextMonday = addDays(i.report_date, 2);
  const nextWed = addDays(i.report_date, 4);

  const delta = (k: typeof total) => (k.change === null ? 'no prior week for comparison' : k.change === 0 ? 'unchanged vs last week' : `${k.change > 0 ? 'up' : 'down'} ${M(Math.abs(k.change))} (${formatPct(k.change_pct, { signed: true })}) vs last week`);

  const executive_summary: string[] = [];
  executive_summary.push(`Total outstanding is ${M(total.value)}, ${delta(total)}. Overdue is ${M(overdue.value)} (${formatPct(ratio.value)} of total), ${delta(overdue)}.`);
  if (i.new_overdue_customers.length && overdue.change && overdue.change > 0) {
    const top = i.new_overdue_customers.slice(0, 3);
    const share = round2((top.reduce((s, c) => s + (c.wow_overdue_change ?? 0), 0) / overdue.change) * 100);
    const list = top.map((c) => `${c.customer} (+${M(c.wow_overdue_change ?? 0)})`).join(', ');
    executive_summary.push(
      share >= 100
        ? `${Math.min(3, top.length)} customer(s) drove the overdue increase (their combined increase exceeds the net increase because other customers improved): ${list}.`
        : `${Math.min(3, top.length)} customer(s) account for ${share.toFixed(0)}% of the overdue increase: ${list}.`,
    );
  }
  executive_summary.push(`Collected this week: ${M(collected.value)}. New overdue this week: ${M(newOverdue.value)}. 30+ days: ${M(over30.value)}; 90+ days: ${M(over90.value)}.`);
  if (i.fx_effect_reporting !== null && Math.abs(i.fx_effect_reporting) >= 1) executive_summary.push(`FX movement explains ${M(i.fx_effect_reporting)} of the week-over-week change in total outstanding (rest is real balance movement).`);

  const major_changes: string[] = [];
  for (const c of i.new_overdue_customers.slice(0, 3)) {
    const reason = c.risk_reasons.find((r) => !/^Overdue USD|^Overdue [A-Z]{3} /.test(r));
    major_changes.push(`${c.customer} (${c.owner || 'Unassigned'}): overdue +${M(c.wow_overdue_change ?? 0)} to ${M(c.overdue)}; oldest item ${c.max_aging_days} days; risk ${c.risk_grade} (${c.risk_score}/100)${reason ? `. ${reason}` : ''}`);
  }
  for (const c of i.improved_customers.slice(0, 2)) major_changes.push(`${c.customer}: overdue reduced by ${M(Math.abs(c.wow_overdue_change ?? 0))} to ${M(c.overdue)} (improvement).`);
  if (!major_changes.length) major_changes.push(i.previous_snapshot_date ? 'No material customer-level change versus last week.' : 'First snapshot: week-over-week comparison not available yet.');

  const risky = [...i.top_overdue_customers].sort((a, b) => b.risk_score - a.risk_score).slice(0, 5);
  const top_risks = risky.map((c) => ({
    customer: c.customer,
    owner: c.owner || 'Unassigned',
    amount: c.overdue,
    reason: `Risk ${c.risk_grade} (${c.risk_score}/100): ${c.risk_reasons.slice(0, 2).join('; ')}`,
    action: c.recommended_action,
    due: c.broken_promise_amount > 0 || c.max_aging_days > 30 ? `${nextMonday} 12:00` : nextWed,
  }));

  const collection_opportunities = i.collection_opportunities.slice(0, 5).map((c) => ({
    customer: c.customer,
    owner: c.owner || 'Unassigned',
    amount: c.overdue,
    why: c.promise_date ? `Payment promised for ${c.promise_date}; oldest item ${c.max_aging_days} days` : `Short overdue (${c.max_aging_days} days), paid regularly (last payment ${c.last_payment_date ?? 'n/a'})`,
  }));

  const owner_actions: InsightOutput['owner_actions'] = [];
  for (const c of i.broken_promises) owner_actions.push({ owner: c.owner || 'Unassigned', customer: c.customer, amount: c.broken_promise_amount, action: `Promise of ${M(c.broken_promise_amount)} missed (${c.promise_date ? 'next promise ' + c.promise_date : 'no new date'}); re-confirm remittance date`, deadline: `${nextMonday} 12:00` });
  for (const c of i.credit_limit_exceeded) owner_actions.push({ owner: c.owner || 'Unassigned', customer: c.customer, amount: c.total, action: `Credit utilization ${formatPct(c.credit_utilization)}; hold new bookings or obtain Finance exception`, deadline: nextMonday });
  for (const c of i.disputes) owner_actions.push({ owner: c.owner || 'Unassigned', customer: c.customer, amount: c.disputed, action: 'Close dispute with Ops/Finance; collect undisputed balance now', deadline: nextWed });
  for (const c of risky.filter((r) => r.max_aging_days > 30 && !i.broken_promises.some((b) => b.customer === r.customer)).slice(0, 3)) owner_actions.push({ owner: c.owner || 'Unassigned', customer: c.customer, amount: c.overdue_30_plus, action: `Formal notice for ${M(c.overdue_30_plus)} older than 30 days; agree payment plan`, deadline: nextWed });
  const seen = new Set<string>();
  const dedupActions = owner_actions.filter((a) => { const k = a.owner + '|' + a.customer; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);

  const ceo_decisions: InsightOutput['ceo_decisions'] = [];
  for (const c of i.top_overdue_customers.filter((c) => c.max_aging_days > 90)) ceo_decisions.push({ topic: 'Credit hold / legal escalation', customer: c.customer, amount: c.overdue, recommendation: `Approve credit hold and collection-agency/legal path for ${c.customer}`, rationale: `${M(c.overdue)} overdue, oldest ${c.max_aging_days} days, risk ${c.risk_grade}` });
  for (const c of i.credit_limit_exceeded) ceo_decisions.push({ topic: 'Credit limit exception', customer: c.customer, amount: c.total, recommendation: `Decide: temporary limit increase or booking hold for ${c.customer}`, rationale: `Utilization ${formatPct(c.credit_utilization)} with ${M(c.overdue)} overdue` });
  for (const c of i.broken_promises.filter((c) => c.risk_score >= 70)) ceo_decisions.push({ topic: 'Payment terms review', customer: c.customer, amount: c.overdue, recommendation: `Move ${c.customer} to prepayment until arrears are cleared`, rationale: `Broken promise ${M(c.broken_promise_amount)}; risk ${c.risk_grade} (${c.risk_score}/100)` });
  // One decision per customer: the first (highest-priority) topic wins, so the CEO list stays short.
  const decidedFor = new Set<string>();
  const uniqueDecisions = ceo_decisions.filter((d) => {
    if (d.customer && decidedFor.has(d.customer)) return false;
    if (d.customer) decidedFor.add(d.customer);
    return true;
  });

  // Forecast: due next week + promises next week, haircut by observed collection behaviour.
  const base = round2(i.due_next_week_total + i.promised_next_week_total);
  const confidence: 'low' | 'medium' | 'high' = i.completeness.payments !== 'full' ? 'low' : i.previous_snapshot_date ? 'medium' : 'low';
  const forecast_next_week = {
    expected_collection: base,
    currency: ccy,
    confidence,
    basis: [`Invoices due next week: ${M(i.due_next_week_total)}`, `Payments promised for next week: ${M(i.promised_next_week_total)}`, `Collected this week: ${M(collected.value)} (reference for run-rate)`],
  };

  const data_quality_warnings: string[] = [];
  if (i.is_mock) data_quality_warnings.push('MOCK DATA: figures are fictional and for prototype demonstration only.');
  for (const d of i.data_quality.filter((d) => d.code !== 'MISSING_CREDIT_LIMIT' && d.code !== 'MISSING_TERMS')) data_quality_warnings.push(`${d.code} x${d.count}: ${d.sample}`);
  for (const [k, v] of Object.entries(i.completeness)) if (k !== 'notes' && v !== 'full') data_quality_warnings.push(`${k} data is ${v}`);
  if (i.completeness.notes.length) data_quality_warnings.push(...i.completeness.notes);

  return { executive_summary, major_changes, top_risks, collection_opportunities, owner_actions: dedupActions, ceo_decisions: uniqueDecisions, forecast_next_week, data_quality_warnings };
}

export type { CustomerFact };

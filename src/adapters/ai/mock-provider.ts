import { addDays } from '@core/dates';
import { pick, RISK_GRADE_LABEL_I18N, type Lang } from '@core/i18n';
import { formatMoney, formatPct, round2 } from '@core/money';
import type { CustomerFact, InsightInput, InsightOutput, InsightProvider } from './types';

/**
 * Deterministic, rule-based insight generator. Used (a) as the mock provider and (b) as the
 * fallback when the live model fails or its output does not pass verification.
 * Every sentence is templated from input figures only, so it always passes verifyInsight().
 * Bilingual (en/ko): only wording changes, never the numbers.
 */
export class RuleBasedInsightProvider implements InsightProvider {
  readonly name = 'rule-based';
  constructor(private readonly lang: Lang = 'en') {}
  async generate(input: InsightInput): Promise<{ output: InsightOutput; model: string | null }> {
    return { output: generateRuleBasedInsight(input, this.lang), model: null };
  }
}

export function generateRuleBasedInsight(i: InsightInput, lang: Lang = 'en'): InsightOutput {
  const p = (en: string, ko: string) => pick(lang, en, ko);
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
  const owner = (c: CustomerFact) => c.owner || p('Unassigned', '담당자 미지정');
  const grade = (g: string) => RISK_GRADE_LABEL_I18N[lang][g] ?? g;

  const delta = (k: typeof total) => {
    if (k.change === null) return p('no prior week for comparison', '비교할 지난주 데이터 없음');
    if (k.change === 0) return p('unchanged vs last week', '전주 대비 변동 없음');
    const amt = M(Math.abs(k.change));
    const pct = formatPct(k.change_pct, { signed: true });
    return k.change > 0 ? p(`up ${amt} (${pct}) vs last week`, `전주 대비 ${amt} 증가 (${pct})`) : p(`down ${amt} (${pct}) vs last week`, `전주 대비 ${amt} 감소 (${pct})`);
  };

  const executive_summary: string[] = [];
  executive_summary.push(
    p(
      `Total outstanding is ${M(total.value)}, ${delta(total)}. Overdue is ${M(overdue.value)} (${formatPct(ratio.value)} of total), ${delta(overdue)}.`,
      `총 미수금은 ${M(total.value)}로 ${delta(total)}했습니다. 연체 미수금은 ${M(overdue.value)}(총액의 ${formatPct(ratio.value)})로 ${delta(overdue)}했습니다.`,
    ),
  );
  if (i.new_overdue_customers.length && overdue.change && overdue.change > 0) {
    const top = i.new_overdue_customers.slice(0, 3);
    const share = round2((top.reduce((s, c) => s + (c.wow_overdue_change ?? 0), 0) / overdue.change) * 100);
    const list = top.map((c) => `${c.customer} (+${M(c.wow_overdue_change ?? 0)})`).join(', ');
    const n = Math.min(3, top.length);
    executive_summary.push(
      share >= 100
        ? p(`${n} customer(s) drove the overdue increase (their combined increase exceeds the net increase because other customers improved): ${list}.`, `연체 증가는 고객사 ${n}곳에서 발생했습니다(다른 고객사의 개선으로 이들의 증가 합계가 순증가분을 초과): ${list}.`)
        : p(`${n} customer(s) account for ${share.toFixed(0)}% of the overdue increase: ${list}.`, `연체 증가분의 ${share.toFixed(0)}%는 고객사 ${n}곳에서 발생했습니다: ${list}.`),
    );
  }
  executive_summary.push(
    p(
      `Collected this week: ${M(collected.value)}. New overdue this week: ${M(newOverdue.value)}. 30+ days: ${M(over30.value)}; 90+ days: ${M(over90.value)}.`,
      `이번 주 회수액 ${M(collected.value)}, 신규 연체 ${M(newOverdue.value)}. 30일 이상 연체 ${M(over30.value)}, 90일 이상 연체 ${M(over90.value)}.`,
    ),
  );
  if (i.fx_effect_reporting !== null && Math.abs(i.fx_effect_reporting) >= 1)
    executive_summary.push(p(`FX movement explains ${M(i.fx_effect_reporting)} of the week-over-week change in total outstanding (rest is real balance movement).`, `총 미수금의 전주 대비 변동 중 ${M(i.fx_effect_reporting)}는 환율 변동 효과이며, 나머지는 실제 잔액 변동입니다.`));

  const major_changes: string[] = [];
  for (const c of i.new_overdue_customers.slice(0, 3)) {
    const reason = c.risk_reasons.find((r) => !/^(Overdue|연체) [A-Z]{3} /.test(r));
    const tail = reason ? `. ${reason}` : '';
    major_changes.push(
      p(
        `${c.customer} (${owner(c)}): overdue +${M(c.wow_overdue_change ?? 0)} to ${M(c.overdue)}; oldest item ${c.max_aging_days} days; risk ${c.risk_grade} (${c.risk_score}/100)${tail}`,
        `${c.customer} (${owner(c)}): 연체 +${M(c.wow_overdue_change ?? 0)} → ${M(c.overdue)}; 최장 연체 ${c.max_aging_days}일; 위험 ${grade(c.risk_grade)} (${c.risk_score}/100)${tail}`,
      ),
    );
  }
  for (const c of i.improved_customers.slice(0, 2)) major_changes.push(p(`${c.customer}: overdue reduced by ${M(Math.abs(c.wow_overdue_change ?? 0))} to ${M(c.overdue)} (improvement).`, `${c.customer}: 연체 ${M(Math.abs(c.wow_overdue_change ?? 0))} 감소 → ${M(c.overdue)} (개선).`));
  if (!major_changes.length) major_changes.push(i.previous_snapshot_date ? p('No material customer-level change versus last week.', '전주 대비 고객사 단위의 유의미한 변화 없음.') : p('First snapshot: week-over-week comparison not available yet.', '첫 스냅샷: 전주 대비 비교 불가.'));

  const risky = [...i.top_overdue_customers].sort((a, b) => b.risk_score - a.risk_score).slice(0, 5);
  const top_risks = risky.map((c) => ({
    customer: c.customer,
    owner: owner(c),
    amount: c.overdue,
    reason: p(`Risk ${c.risk_grade} (${c.risk_score}/100): ${c.risk_reasons.slice(0, 2).join('; ')}`, `위험 ${grade(c.risk_grade)} (${c.risk_score}/100): ${c.risk_reasons.slice(0, 2).join('; ')}`),
    action: c.recommended_action,
    due: c.broken_promise_amount > 0 || c.max_aging_days > 30 ? `${nextMonday} 12:00` : nextWed,
  }));

  const collection_opportunities = i.collection_opportunities.slice(0, 5).map((c) => ({
    customer: c.customer,
    owner: owner(c),
    amount: c.overdue,
    why: c.promise_date
      ? p(`Payment promised for ${c.promise_date}; oldest item ${c.max_aging_days} days`, `${c.promise_date} 지급 약속; 최장 연체 ${c.max_aging_days}일`)
      : p(`Short overdue (${c.max_aging_days} days), paid regularly (last payment ${c.last_payment_date ?? 'n/a'})`, `단기 연체(${c.max_aging_days}일), 정기 결제 이력 있음(최근 입금 ${c.last_payment_date ?? '없음'})`),
  }));

  const owner_actions: InsightOutput['owner_actions'] = [];
  for (const c of i.broken_promises)
    owner_actions.push({
      owner: owner(c),
      customer: c.customer,
      amount: c.broken_promise_amount,
      action: p(`Promise of ${M(c.broken_promise_amount)} missed (${c.promise_date ? 'next promise ' + c.promise_date : 'no new date'}); re-confirm remittance date`, `${M(c.broken_promise_amount)} 지급 약속 미이행(${c.promise_date ? '다음 약속일 ' + c.promise_date : '새 약속일 없음'}); 송금일 재확정`),
      deadline: `${nextMonday} 12:00`,
    });
  for (const c of i.credit_limit_exceeded) owner_actions.push({ owner: owner(c), customer: c.customer, amount: c.total, action: p(`Credit utilization ${formatPct(c.credit_utilization)}; hold new bookings or obtain Finance exception`, `신용한도 사용률 ${formatPct(c.credit_utilization)}; 신규 예약 보류 또는 Finance 예외 승인`), deadline: nextMonday });
  for (const c of i.disputes) owner_actions.push({ owner: owner(c), customer: c.customer, amount: c.disputed, action: p('Close dispute with Ops/Finance; collect undisputed balance now', 'Ops·Finance와 분쟁 종결; 분쟁 없는 잔액 즉시 회수'), deadline: nextWed });
  for (const c of risky.filter((r) => r.max_aging_days > 30 && !i.broken_promises.some((b) => b.customer === r.customer)).slice(0, 3))
    owner_actions.push({ owner: owner(c), customer: c.customer, amount: c.overdue_30_plus, action: p(`Formal notice for ${M(c.overdue_30_plus)} older than 30 days; agree payment plan`, `30일 초과 연체 ${M(c.overdue_30_plus)} 공식 통지; 분할 지급 계획 합의`), deadline: nextWed });
  const seen = new Set<string>();
  const dedupActions = owner_actions
    .filter((a) => {
      const k = a.owner + '|' + a.customer;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);

  const ceo_decisions: InsightOutput['ceo_decisions'] = [];
  for (const c of i.top_overdue_customers.filter((c) => c.max_aging_days > 90))
    ceo_decisions.push({ topic: p('Credit hold / legal escalation', '신용 중단 / 법무 에스컬레이션'), customer: c.customer, amount: c.overdue, recommendation: p(`Approve credit hold and collection-agency/legal path for ${c.customer}`, `${c.customer}에 대한 신용 중단 및 추심·법무 절차 승인`), rationale: p(`${M(c.overdue)} overdue, oldest ${c.max_aging_days} days, risk ${c.risk_grade}`, `연체 ${M(c.overdue)}, 최장 ${c.max_aging_days}일, 위험 ${grade(c.risk_grade)}`) });
  for (const c of i.credit_limit_exceeded)
    ceo_decisions.push({ topic: p('Credit limit exception', '신용한도 예외'), customer: c.customer, amount: c.total, recommendation: p(`Decide: temporary limit increase or booking hold for ${c.customer}`, `${c.customer}: 임시 한도 증액 또는 예약 보류 결정`), rationale: p(`Utilization ${formatPct(c.credit_utilization)} with ${M(c.overdue)} overdue`, `사용률 ${formatPct(c.credit_utilization)}, 연체 ${M(c.overdue)}`) });
  for (const c of i.broken_promises.filter((c) => c.risk_score >= 70))
    ceo_decisions.push({ topic: p('Payment terms review', '결제조건 변경'), customer: c.customer, amount: c.overdue, recommendation: p(`Move ${c.customer} to prepayment until arrears are cleared`, `${c.customer}를 연체 해소 전까지 선결제로 전환`), rationale: p(`Broken promise ${M(c.broken_promise_amount)}; risk ${c.risk_grade} (${c.risk_score}/100)`, `약속 불이행 ${M(c.broken_promise_amount)}; 위험 ${grade(c.risk_grade)} (${c.risk_score}/100)`) });
  // One decision per customer: the first (highest-priority) topic wins, so the CEO list stays short.
  const decidedFor = new Set<string>();
  const uniqueDecisions = ceo_decisions.filter((d) => {
    if (d.customer && decidedFor.has(d.customer)) return false;
    if (d.customer) decidedFor.add(d.customer);
    return true;
  });

  const base = round2(i.due_next_week_total + i.promised_next_week_total);
  const confidence: 'low' | 'medium' | 'high' = i.completeness.payments !== 'full' ? 'low' : i.previous_snapshot_date ? 'medium' : 'low';
  const forecast_next_week = {
    expected_collection: base,
    currency: ccy,
    confidence,
    basis: [
      p(`Invoices due next week: ${M(i.due_next_week_total)}`, `다음 주 만기 Invoice: ${M(i.due_next_week_total)}`),
      p(`Payments promised for next week: ${M(i.promised_next_week_total)}`, `다음 주 지급 약속: ${M(i.promised_next_week_total)}`),
      p(`Collected this week: ${M(collected.value)} (reference for run-rate)`, `이번 주 회수액: ${M(collected.value)} (회수 속도 참고)`),
    ],
  };

  const data_quality_warnings: string[] = [];
  if (i.is_mock) data_quality_warnings.push(p('MOCK DATA: figures are fictional and for prototype demonstration only.', 'MOCK DATA: 프로토타입 시연용 가상 수치입니다.'));
  for (const d of i.data_quality.filter((d) => d.code !== 'MISSING_CREDIT_LIMIT' && d.code !== 'MISSING_TERMS')) data_quality_warnings.push(`${d.code} x${d.count}: ${d.sample}`);
  for (const [k, v] of Object.entries(i.completeness)) if (k !== 'notes' && v !== 'full') data_quality_warnings.push(p(`${k} data is ${v}`, `${k} 데이터 ${v === 'partial' ? '일부 누락' : '없음'}`));
  if (i.completeness.notes.length) data_quality_warnings.push(...i.completeness.notes);

  return { executive_summary, major_changes, top_risks, collection_opportunities, owner_actions: dedupActions, ceo_decisions: uniqueDecisions, forecast_next_week, data_quality_warnings };
}

export type { CustomerFact };

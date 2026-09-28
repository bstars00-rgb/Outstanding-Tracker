import { addDays, daysBetween } from './dates';
import { pick, type Lang } from './i18n';
import type { ActionItem, CalculatedInvoice, CustomerRisk, ISODate, ReflectionItem } from './types';

/**
 * Collection Action Board: one item per (group, customer[, invoice]).
 * Groups are evaluated in priority order; an invoice appears in its highest-priority group only,
 * while customer-level groups (credit limit, escalation, broken promise) are separate items.
 */
export function buildActions(invoices: CalculatedInvoice[], customers: CustomerRisk[], ref: ISODate, _ccy: string, lang: Lang = 'en', reflection: ReflectionItem[] = []): ActionItem[] {
  const p = (en: string, ko: string) => pick(lang, en, ko);
  const items: ActionItem[] = [];
  const open = invoices.filter((i) => i.outstanding_amount > 0);
  const custMap = new Map(customers.map((c) => [c.customer_id, c]));

  for (const i of open) {
    const c = custMap.get(i.customer_id);
    const owner = c?.account_owner_name ?? i.owner;
    const aging = i.aging_days;
    const base = { customer_id: i.customer_id, customer_name: i.customer_name, invoice_id: i.invoice_id, owner, amount_reporting: i.outstanding_reporting, status: 'open' as const };
    if (i.disputed_reporting > 0 && (i.dispute_status === 'OPEN' || i.dispute_status === 'UNDER_REVIEW')) {
      const reason = i.dispute_reason ?? p('reason not recorded', '사유 미기록');
      items.push({ ...base, id: `DISPUTE:${i.invoice_id}`, group: 'DISPUTE', due_date: addDays(ref, 5), severity: 'high', recommended_action: p(`Resolve dispute (${reason}); collect undisputed portion now`, `분쟁 해결(${reason}); 분쟁 없는 금액은 즉시 회수`) });
      continue;
    }
    if (aging !== null && aging > 90) {
      items.push({ ...base, id: `OVERDUE_90:${i.invoice_id}`, group: 'OVERDUE_90', due_date: ref, severity: 'critical', recommended_action: p('Final notice; propose credit hold and agency/legal path to Finance leader', '최종 통지; Finance 리더에게 신용 중단 및 추심·법무 경로 제안') });
      continue;
    }
    if (aging !== null && aging > 30) {
      items.push({ ...base, id: `OVERDUE_30:${i.invoice_id}`, group: 'OVERDUE_30', due_date: addDays(ref, 2), severity: 'high', recommended_action: p('Formal overdue notice + call decision maker; agree payment plan', '공식 연체 통지 및 의사결정자 통화; 분할 지급 계획 합의') });
      continue;
    }
    if (i.promised_payment_date && i.promised_payment_date < ref) {
      items.push({ ...base, id: `PROMISE_OVERDUE:${i.invoice_id}`, group: 'PROMISE_OVERDUE', due_date: addDays(ref, 1), severity: 'high', recommended_action: p(`Promise ${i.promised_payment_date} missed; re-confirm remittance date by Monday 12:00`, `${i.promised_payment_date} 약속 미이행; 월요일 12:00까지 송금일 재확정`) });
      continue;
    }
    if (aging !== null && aging > 0) {
      items.push({ ...base, id: `CONTACT_TODAY:${i.invoice_id}`, group: 'CONTACT_TODAY', due_date: ref, severity: aging > 14 ? 'high' : 'medium', recommended_action: p(`Overdue ${aging} day(s); send reminder and confirm payment date`, `연체 ${aging}일; 리마인더 발송 및 지급일 확인`) });
      continue;
    }
    if (i.due_date) {
      const untilDue = daysBetween(ref, i.due_date);
      if (untilDue >= 0 && untilDue <= 3) {
        items.push({ ...base, id: `DUE_3:${i.invoice_id}`, group: 'DUE_3_DAYS', due_date: i.due_date, severity: 'medium', recommended_action: p('Pre-due courtesy reminder with remittance details', '만기 전 안내 리마인더(송금 정보 포함) 발송') });
        continue;
      }
      if (untilDue > 3 && untilDue <= 7) {
        items.push({ ...base, id: `DUE_7:${i.invoice_id}`, group: 'DUE_7_DAYS', due_date: i.due_date, severity: 'low', recommended_action: p('Confirm invoice received and approved for payment', 'Invoice 수령 및 지급 승인 여부 확인') });
        continue;
      }
    }
    if (i.next_action_date && i.next_action_date <= ref && i.next_action) {
      items.push({ ...base, id: `NEXT_ACTION:${i.invoice_id}`, group: 'CONTACT_TODAY', due_date: i.next_action_date, severity: 'medium', recommended_action: i.next_action });
    }
  }

  // OMH SOP: L1 (Tier 1, >= ¥1M overdue) must reach the CEO within 24h; items past their Tier collection period go to the probability checklist.
  for (const i of open) {
    const owner = custMap.get(i.customer_id)?.account_owner_name ?? i.owner;
    if (i.sop.level === 'L1') {
      items.push({ id: `SOP_L1:${i.invoice_id}`, group: 'ESCALATE', customer_id: i.customer_id, customer_name: i.customer_name, invoice_id: i.invoice_id, owner, due_date: addDays(ref, 1), amount_reporting: i.outstanding_reporting, severity: 'critical', status: 'open', recommended_action: p(`SOP L1 (Tier 1, ≥ ¥1M, overdue ${i.aging_days} day(s)): report OP → Director → Finance → CEO within 24h and confirm the remittance date`, `SOP L1(Tier 1, ¥1M 이상, 연체 ${i.aging_days}일): 24시간 내 OP→Director→Finance→CEO 보고, 송금일 확정`) });
    }
    if (i.sop.past_tier_deadline) {
      const route = i.sop.route === 'CEO' ? p('CEO approval (> ¥500K)', 'CEO 승인(¥500K 초과)') : p('Local Director decision (≤ ¥500K)', 'Local Director 결정(¥500K 이하)');
      items.push({ id: `SOP_DEADLINE:${i.invoice_id}`, group: 'ESCALATE', customer_id: i.customer_id, customer_name: i.customer_name, invoice_id: i.invoice_id, owner, due_date: addDays(ref, 5), amount_reporting: i.outstanding_reporting, severity: 'high', status: 'open', recommended_action: p(`Tier ${i.sop.tier} collection period ended ${i.sop.tier_deadline}: run the collection-probability checklist; route ${route}`, `Tier ${i.sop.tier} 회수기한 ${i.sop.tier_deadline} 경과: 회수 확률 체크리스트 실행, ${route} 경로`) });
    }
  }

  for (const c of customers) {
    if (c.credit_limit_exceeded) {
      const util = Math.round((c.credit_utilization ?? 0) * 100);
      items.push({ id: `CREDIT_LIMIT:${c.customer_id}`, group: 'CREDIT_LIMIT', customer_id: c.customer_id, customer_name: c.customer_name, invoice_id: null, owner: c.account_owner_name, due_date: ref, amount_reporting: c.total_outstanding_reporting, severity: 'high', status: 'open', recommended_action: p(`Utilization ${util}%: hold new bookings or obtain Finance exception approval`, `사용률 ${util}%: 신규 예약 보류 또는 Finance 예외 승인 확보`) });
    }
    if (c.risk.grade === 'Critical' || (c.risk.grade === 'High' && c.promise_broken) || c.overdue_90_plus_reporting > 0) {
      items.push({ id: `ESCALATE:${c.customer_id}`, group: 'ESCALATE', customer_id: c.customer_id, customer_name: c.customer_name, invoice_id: null, owner: c.account_owner_name, due_date: addDays(ref, 2), amount_reporting: c.overdue_reporting, severity: 'critical', status: 'open', recommended_action: p(`Risk ${c.risk.grade} (${c.risk.score}/100): leader review of credit terms and collection strategy`, `위험 ${c.risk.grade} (${c.risk.score}/100): 리더가 신용 조건과 회수 전략 검토`) });
    }
  }

  // ELLIS reflection chain: payments waiting for verification / reconciliation beyond their SLA.
  for (const r of reflection.filter((x) => x.stage !== 'RECONCILED' && x.overdue_sla)) {
    const stageLabel = r.stage === 'RECORDED' ? p('verify in ELLIS (PM CNFM + invoice mapping)', 'ELLIS 검증(PM CNFM·인보이스 매핑)') : p('reconcile against bank statement', '은행 입금 대사·승인');
    items.push({ id: `ELLIS_REFLECTION:${r.payment_id}`, group: 'ELLIS_REFLECTION', customer_id: r.customer_id, customer_name: r.customer_name, invoice_id: null, owner: r.next_owner, due_date: addDays(r.payment_date, r.sla_days), amount_reporting: r.amount_reporting, severity: r.days_in_stage > r.sla_days * 3 ? 'high' : 'medium', status: 'open', recommended_action: p(`Payment ${r.payment_date} (${r.currency} ${r.amount.toLocaleString('en-US')}) waiting ${r.days_in_stage} day(s): ${stageLabel}`, `${r.payment_date} 입금(${r.currency} ${r.amount.toLocaleString('en-US')}) ${r.days_in_stage}일째 대기: ${stageLabel}`) });
  }

  const sevRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return items.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.amount_reporting - a.amount_reporting);
}

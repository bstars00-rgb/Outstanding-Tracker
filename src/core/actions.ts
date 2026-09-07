import { addDays, daysBetween } from './dates';
import type { ActionItem, CalculatedInvoice, CustomerRisk, ISODate } from './types';

/**
 * Collection Action Board: one item per (group, customer[, invoice]).
 * Groups are evaluated in priority order; an invoice appears in its highest-priority group only,
 * while customer-level groups (credit limit, escalation, broken promise) are separate items.
 */
export function buildActions(invoices: CalculatedInvoice[], customers: CustomerRisk[], ref: ISODate, _ccy: string): ActionItem[] {
  const items: ActionItem[] = [];
  const open = invoices.filter((i) => i.outstanding_amount > 0);
  const custMap = new Map(customers.map((c) => [c.customer_id, c]));

  for (const i of open) {
    const c = custMap.get(i.customer_id);
    const owner = c?.account_owner_name ?? i.owner;
    const aging = i.aging_days;
    const base = { customer_id: i.customer_id, customer_name: i.customer_name, invoice_id: i.invoice_id, owner, amount_reporting: i.outstanding_reporting, status: 'open' as const };
    if (i.disputed_reporting > 0 && (i.dispute_status === 'OPEN' || i.dispute_status === 'UNDER_REVIEW')) {
      items.push({ ...base, id: `DISPUTE:${i.invoice_id}`, group: 'DISPUTE', due_date: addDays(ref, 5), severity: 'high', recommended_action: `Resolve dispute (${i.dispute_reason ?? 'reason not recorded'}); collect undisputed portion now` });
      continue;
    }
    if (aging !== null && aging > 90) {
      items.push({ ...base, id: `OVERDUE_90:${i.invoice_id}`, group: 'OVERDUE_90', due_date: ref, severity: 'critical', recommended_action: 'Final notice; propose credit hold and agency/legal path to Finance leader' });
      continue;
    }
    if (aging !== null && aging > 30) {
      items.push({ ...base, id: `OVERDUE_30:${i.invoice_id}`, group: 'OVERDUE_30', due_date: addDays(ref, 2), severity: 'high', recommended_action: 'Formal overdue notice + call decision maker; agree payment plan' });
      continue;
    }
    if (i.promised_payment_date && i.promised_payment_date < ref) {
      items.push({ ...base, id: `PROMISE_OVERDUE:${i.invoice_id}`, group: 'PROMISE_OVERDUE', due_date: addDays(ref, 1), severity: 'high', recommended_action: `Promise ${i.promised_payment_date} missed; re-confirm remittance date by Monday 12:00` });
      continue;
    }
    if (aging !== null && aging > 0) {
      items.push({ ...base, id: `CONTACT_TODAY:${i.invoice_id}`, group: 'CONTACT_TODAY', due_date: ref, severity: aging > 14 ? 'high' : 'medium', recommended_action: `Overdue ${aging} day(s); send reminder and confirm payment date` });
      continue;
    }
    if (i.due_date) {
      const untilDue = daysBetween(ref, i.due_date);
      if (untilDue >= 0 && untilDue <= 3) {
        items.push({ ...base, id: `DUE_3:${i.invoice_id}`, group: 'DUE_3_DAYS', due_date: i.due_date, severity: 'medium', recommended_action: 'Pre-due courtesy reminder with remittance details' });
        continue;
      }
      if (untilDue > 3 && untilDue <= 7) {
        items.push({ ...base, id: `DUE_7:${i.invoice_id}`, group: 'DUE_7_DAYS', due_date: i.due_date, severity: 'low', recommended_action: 'Confirm invoice received and approved for payment' });
        continue;
      }
    }
    if (i.next_action_date && i.next_action_date <= ref && i.next_action) {
      items.push({ ...base, id: `NEXT_ACTION:${i.invoice_id}`, group: 'CONTACT_TODAY', due_date: i.next_action_date, severity: 'medium', recommended_action: i.next_action });
    }
  }

  for (const c of customers) {
    if (c.credit_limit_exceeded) {
      items.push({ id: `CREDIT_LIMIT:${c.customer_id}`, group: 'CREDIT_LIMIT', customer_id: c.customer_id, customer_name: c.customer_name, invoice_id: null, owner: c.account_owner_name, due_date: ref, amount_reporting: c.total_outstanding_reporting, severity: 'high', status: 'open', recommended_action: `Utilization ${Math.round((c.credit_utilization ?? 0) * 100)}%: hold new bookings or obtain Finance exception approval` });
    }
    if (c.risk.grade === 'Critical' || (c.risk.grade === 'High' && c.promise_broken) || c.overdue_90_plus_reporting > 0) {
      items.push({ id: `ESCALATE:${c.customer_id}`, group: 'ESCALATE', customer_id: c.customer_id, customer_name: c.customer_name, invoice_id: null, owner: c.account_owner_name, due_date: addDays(ref, 2), amount_reporting: c.overdue_reporting, severity: 'critical', status: 'open', recommended_action: `Risk ${c.risk.grade} (${c.risk.score}/100): leader review of credit terms and collection strategy` });
    }
  }

  const sevRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return items.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.amount_reporting - a.amount_reporting);
}

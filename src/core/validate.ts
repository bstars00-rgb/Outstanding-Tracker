import { z } from 'zod';
import type { DataQualityIssue, ReceivablesDataset } from './types';
import { round2 } from './money';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD expected');
const ccy = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code expected');

export const CustomerSchema = z.object({
  customer_id: z.string().min(1),
  customer_name: z.string().min(1),
  customer_group: z.string().nullable(),
  country: z.string().min(1),
  region: z.string(),
  account_owner_id: z.string(),
  account_owner_name: z.string(),
  finance_owner: z.string().nullable(),
  contract_currency: ccy,
  payment_terms_days: z.number().int().nonnegative().nullable(),
  credit_limit: z.number().nonnegative().nullable(),
  credit_status: z.enum(['ACTIVE', 'ON_HOLD', 'SUSPENDED']),
  customer_status: z.enum(['ACTIVE', 'INACTIVE', 'CHURNED']),
  collection_status: z.enum(['NORMAL', 'REMINDER', 'ESCALATED', 'LEGAL']),
  risk_grade_manual: z.enum(['Low', 'Watch', 'Medium', 'High', 'Critical']).nullable(),
  preferred_contact_channel: z.string().nullable(),
  data_source: z.string(),
});

export const InvoiceSchema = z.object({
  invoice_id: z.string().min(1),
  invoice_number: z.string(),
  booking_id: z.string().nullable(),
  customer_id: z.string().min(1),
  invoice_date: isoDate,
  service_date: isoDate.nullable(),
  due_date: isoDate.nullable(),
  original_amount: z.number().finite(),
  paid_amount: z.number().finite(),
  credit_note_amount: z.number().finite(),
  disputed_amount: z.number().finite().nonnegative(),
  outstanding_amount: z.number().finite(),
  invoice_currency: ccy,
  invoice_status: z.enum(['OPEN', 'PARTIALLY_PAID', 'PAID', 'DISPUTED', 'CANCELLED', 'CREDITED', 'WRITTEN_OFF']),
  dispute_status: z.enum(['NONE', 'OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED']),
  dispute_reason: z.string().nullable(),
  cancellation_status: z.enum(['NONE', 'REQUESTED', 'CANCELLED']),
  last_payment_date: isoDate.nullable(),
  last_payment_amount: z.number().nullable(),
  data_source: z.string(),
});

export const PaymentSchema = z.object({
  payment_id: z.string().min(1),
  invoice_id: z.string().nullable(),
  customer_id: z.string().min(1),
  payment_date: isoDate,
  payment_amount: z.number().finite(),
  payment_currency: ccy,
  applied_amount: z.number().finite(),
  unapplied_amount: z.number().finite(),
  payment_method: z.enum(['BANK_TRANSFER', 'CARD', 'VCC', 'OFFSET', 'OTHER']),
  payment_reference: z.string().nullable(),
  reconciliation_status: z.enum(['APPLIED', 'PARTIALLY_APPLIED', 'UNAPPLIED', 'REFUNDED']),
  data_source: z.string(),
});

export const ActivitySchema = z.object({
  activity_id: z.string().min(1),
  customer_id: z.string().min(1),
  invoice_id: z.string().nullable(),
  owner: z.string(),
  activity_type: z.enum(['CALL', 'EMAIL', 'MEETING', 'REMINDER', 'PROMISE', 'DISPUTE', 'ESCALATION', 'NOTE']),
  activity_date: isoDate,
  contact_channel: z.string().nullable(),
  note: z.string(),
  promised_payment_date: isoDate.nullable(),
  promised_payment_amount: z.number().nullable(),
  promised_currency: ccy.nullable(),
  next_action: z.string().nullable(),
  next_action_date: isoDate.nullable(),
  escalation_level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  completed: z.boolean(),
});

export const FxTableSchema = z.object({
  reporting_currency: ccy,
  as_of: isoDate,
  rates: z.array(z.object({ currency: ccy, rate_to_reporting: z.number().positive(), rate_date: isoDate, source: z.string() })),
});

export const DatasetSchema = z.object({
  as_of: z.string().datetime({ offset: true }),
  source: z.enum(['mock', 'ellis-mcp', 'ellis-bookings-derived', 'file']),
  reporting_currency: ccy,
  fx: FxTableSchema,
  customers: z.array(CustomerSchema),
  invoices: z.array(InvoiceSchema),
  payments: z.array(PaymentSchema),
  activities: z.array(ActivitySchema),
  bookings: z.array(z.any()),
  completeness: z.object({
    customers: z.enum(['full', 'partial', 'missing']),
    invoices: z.enum(['full', 'partial', 'missing']),
    payments: z.enum(['full', 'partial', 'missing']),
    activities: z.enum(['full', 'partial', 'missing']),
    fx: z.enum(['full', 'partial', 'missing']),
    notes: z.array(z.string()),
  }),
});

export interface ValidationResult {
  ok: boolean; // false => schema errors: do NOT report on this data
  issues: DataQualityIssue[];
}

/**
 * Structural (schema) validation + semantic data-quality checks.
 * Schema violations are `error` severity and make `ok=false`.
 * Semantic problems (missing due date, amount mismatch, unknown currency) are warnings
 * that the calculation engine handles explicitly and surfaces in the UI / report.
 */
export function validateDataset(ds: unknown): ValidationResult {
  const issues: DataQualityIssue[] = [];
  const parsed = DatasetSchema.safeParse(ds);
  if (!parsed.success) {
    for (const e of parsed.error.issues.slice(0, 50)) {
      issues.push({ severity: 'error', code: 'SCHEMA_VIOLATION', entity: 'dataset', entity_id: e.path.join('.'), message: e.message });
    }
    return { ok: false, issues };
  }
  const d = parsed.data as ReceivablesDataset;
  const customerIds = new Set(d.customers.map((c) => c.customer_id));
  const invoiceIds = new Set<string>();
  const knownCcy = new Set([d.reporting_currency, ...d.fx.rates.map((r) => r.currency)]);

  for (const inv of d.invoices) {
    if (invoiceIds.has(inv.invoice_id)) issues.push({ severity: 'error', code: 'DUPLICATE_INVOICE', entity: 'invoice', entity_id: inv.invoice_id, message: 'Duplicate invoice_id' });
    invoiceIds.add(inv.invoice_id);
    if (!customerIds.has(inv.customer_id)) issues.push({ severity: 'error', code: 'ORPHAN_INVOICE', entity: 'invoice', entity_id: inv.invoice_id, message: `Unknown customer ${inv.customer_id}` });
    if (!inv.due_date && inv.invoice_status !== 'CANCELLED' && inv.invoice_status !== 'PAID')
      issues.push({ severity: 'warning', code: 'MISSING_DUE_DATE', entity: 'invoice', entity_id: inv.invoice_id, message: 'Missing due_date; aging cannot be computed' });
    if (!knownCcy.has(inv.invoice_currency)) issues.push({ severity: 'warning', code: 'MISSING_FX_RATE', entity: 'fx', entity_id: inv.invoice_id, message: `No FX rate for ${inv.invoice_currency}` });
    const expected = round2(inv.original_amount - inv.paid_amount - inv.credit_note_amount);
    if (inv.invoice_status !== 'CANCELLED' && Math.abs(expected - inv.outstanding_amount) > 0.01)
      issues.push({ severity: 'warning', code: 'AMOUNT_MISMATCH', entity: 'invoice', entity_id: inv.invoice_id, message: `outstanding ${inv.outstanding_amount} != original - paid - credit_note (${expected}); engine uses recomputed value` });
    if (inv.outstanding_amount < -0.01) issues.push({ severity: 'warning', code: 'OVERPAYMENT', entity: 'invoice', entity_id: inv.invoice_id, message: 'Negative outstanding (overpayment) treated as unapplied cash' });
    if (inv.disputed_amount > inv.outstanding_amount + 0.01 && inv.outstanding_amount >= 0)
      issues.push({ severity: 'warning', code: 'DISPUTE_EXCEEDS_OUTSTANDING', entity: 'invoice', entity_id: inv.invoice_id, message: 'Disputed amount exceeds outstanding; capped' });
  }
  for (const p of d.payments) {
    if (!customerIds.has(p.customer_id)) issues.push({ severity: 'error', code: 'ORPHAN_PAYMENT', entity: 'payment', entity_id: p.payment_id, message: `Unknown customer ${p.customer_id}` });
    if (p.invoice_id && !invoiceIds.has(p.invoice_id)) issues.push({ severity: 'warning', code: 'PAYMENT_UNKNOWN_INVOICE', entity: 'payment', entity_id: p.payment_id, message: `Payment references unknown invoice ${p.invoice_id}` });
    if (Math.abs(p.applied_amount + p.unapplied_amount - p.payment_amount) > 0.01 && p.reconciliation_status !== 'REFUNDED')
      issues.push({ severity: 'warning', code: 'PAYMENT_SPLIT_MISMATCH', entity: 'payment', entity_id: p.payment_id, message: 'applied + unapplied != payment_amount' });
  }
  for (const c of d.customers) {
    if (c.credit_limit === null) issues.push({ severity: 'info', code: 'MISSING_CREDIT_LIMIT', entity: 'customer', entity_id: c.customer_id, message: 'No credit limit on file' });
    if (!c.account_owner_id) issues.push({ severity: 'warning', code: 'MISSING_OWNER', entity: 'customer', entity_id: c.customer_id, message: 'No account owner assigned' });
    if (c.payment_terms_days === null) issues.push({ severity: 'info', code: 'MISSING_TERMS', entity: 'customer', entity_id: c.customer_id, message: 'Payment terms not on file' });
  }
  for (const a of d.activities) {
    if (!customerIds.has(a.customer_id)) issues.push({ severity: 'warning', code: 'ORPHAN_ACTIVITY', entity: 'activity', entity_id: a.activity_id, message: `Unknown customer ${a.customer_id}` });
  }
  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, issues };
}

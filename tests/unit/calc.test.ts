import { describe, expect, it } from 'vitest';
import { buildTrackerModel } from '@core/calc';
import { bucketFor, agingDays } from '@core/aging';
import { addDays } from '@core/dates';
import type { Customer, Invoice, Payment, ReceivablesDataset, CollectionActivity } from '@core/types';

const REF = '2026-09-05';

function customer(over: Partial<Customer> = {}): Customer {
  return {
    customer_id: 'c1',
    customer_name: 'Alpha Travel',
    customer_group: null,
    country: 'Korea',
    region: 'NEA',
    account_owner_id: 'o1',
    account_owner_name: 'Owner One',
    finance_owner: null,
    contract_currency: 'USD',
    payment_terms_days: 14,
    credit_limit: 100_000,
    credit_status: 'ACTIVE',
    customer_status: 'ACTIVE',
    collection_status: 'NORMAL',
    risk_grade_manual: null,
    preferred_contact_channel: null,
    data_source: 'test',
    ...over,
  };
}
function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    invoice_id: 'i1',
    invoice_number: 'INV-1',
    booking_id: null,
    customer_id: 'c1',
    invoice_date: addDays(REF, -30),
    service_date: addDays(REF, -30),
    due_date: addDays(REF, -16),
    original_amount: 1000,
    paid_amount: 0,
    credit_note_amount: 0,
    disputed_amount: 0,
    outstanding_amount: 1000,
    invoice_currency: 'USD',
    invoice_status: 'OPEN',
    dispute_status: 'NONE',
    dispute_reason: null,
    cancellation_status: 'NONE',
    last_payment_date: null,
    last_payment_amount: null,
    data_source: 'test',
    ...over,
  };
}
function payment(over: Partial<Payment> = {}): Payment {
  return { payment_id: 'p1', invoice_id: 'i1', customer_id: 'c1', payment_date: addDays(REF, -2), payment_amount: 400, payment_currency: 'USD', applied_amount: 400, unapplied_amount: 0, payment_method: 'BANK_TRANSFER', payment_reference: null, reconciliation_status: 'APPLIED', data_source: 'test', ...over };
}
function dataset(parts: Partial<ReceivablesDataset> = {}): ReceivablesDataset {
  return {
    as_of: `${REF}T02:00:00.000Z`,
    source: 'mock',
    reporting_currency: 'USD',
    fx: { reporting_currency: 'USD', as_of: REF, rates: [{ currency: 'KRW', rate_to_reporting: 0.0007, rate_date: REF, source: 'test' }, { currency: 'JPY', rate_to_reporting: 0.007, rate_date: REF, source: 'test' }] },
    customers: [customer()],
    invoices: [invoice()],
    payments: [],
    activities: [],
    bookings: [],
    completeness: { customers: 'full', invoices: 'full', payments: 'full', activities: 'full', fx: 'full', notes: [] },
    ...parts,
  };
}
const build = (ds: ReceivablesDataset, prev = null as ReturnType<typeof buildTrackerModel>['snapshot'] | null) => buildTrackerModel(ds, { referenceDate: REF, previousSnapshot: prev });

describe('aging', () => {
  it('computes aging days as reference - due', () => {
    expect(agingDays(REF, addDays(REF, -16))).toBe(16);
    expect(agingDays(REF, addDays(REF, 3))).toBe(-3);
    expect(agingDays(REF, null)).toBeNull();
  });
  it('maps bucket boundaries exactly', () => {
    expect(bucketFor(-5)).toBe('CURRENT');
    expect(bucketFor(0)).toBe('CURRENT');
    expect(bucketFor(1)).toBe('D1_7');
    expect(bucketFor(7)).toBe('D1_7');
    expect(bucketFor(8)).toBe('D8_14');
    expect(bucketFor(14)).toBe('D8_14');
    expect(bucketFor(15)).toBe('D15_30');
    expect(bucketFor(30)).toBe('D15_30');
    expect(bucketFor(31)).toBe('D31_60');
    expect(bucketFor(60)).toBe('D31_60');
    expect(bucketFor(61)).toBe('D61_90');
    expect(bucketFor(90)).toBe('D61_90');
    expect(bucketFor(91)).toBe('D90_PLUS');
    expect(bucketFor(null)).toBe('UNKNOWN');
  });
});

describe('buildTrackerModel totals', () => {
  it('splits total into overdue and not-yet-due', () => {
    const m = build(dataset({ invoices: [invoice(), invoice({ invoice_id: 'i2', due_date: addDays(REF, 5), original_amount: 500, outstanding_amount: 500 })] }));
    expect(m.snapshot.totals.total_outstanding).toBe(1500);
    expect(m.snapshot.totals.overdue_outstanding).toBe(1000);
    expect(m.snapshot.totals.not_yet_due).toBe(500);
    expect(m.snapshot.totals.due_within_7_days).toBe(500);
    expect(m.kpis.find((k) => k.key === 'overdue_ratio')!.value).toBeCloseTo(1000 / 1500, 4);
  });
  it('excludes cancelled invoices and applies credit notes / partial payments from components', () => {
    const m = build(
      dataset({
        invoices: [
          invoice({ invoice_id: 'i1', original_amount: 1000, paid_amount: 300, credit_note_amount: 200, outstanding_amount: 999 /* wrong on purpose */ }),
          invoice({ invoice_id: 'i2', original_amount: 800, outstanding_amount: 800, invoice_status: 'CANCELLED', cancellation_status: 'CANCELLED' }),
        ],
      }),
    );
    expect(m.snapshot.totals.total_outstanding).toBe(500);
    expect(m.snapshot.totals.credit_notes_applied).toBe(200);
    expect(m.invoices.find((i) => i.invoice_id === 'i2')!.outstanding_amount).toBe(0);
  });
  it('treats overpayment as unapplied cash, never negative receivable', () => {
    const m = build(dataset({ invoices: [invoice({ paid_amount: 1200, outstanding_amount: -200 })], payments: [payment({ payment_amount: 1200, applied_amount: 1200, payment_date: addDays(REF, -20) })] }));
    expect(m.snapshot.totals.total_outstanding).toBe(0);
    expect(m.snapshot.totals.unapplied_cash).toBe(200);
  });
  it('counts unapplied cash from payments and ignores refunds', () => {
    const m = build(dataset({ payments: [payment({ applied_amount: 0, unapplied_amount: 400, reconciliation_status: 'UNAPPLIED', invoice_id: null }), payment({ payment_id: 'p2', payment_amount: -500, applied_amount: 0, unapplied_amount: 0, reconciliation_status: 'REFUNDED' })] }));
    expect(m.snapshot.totals.unapplied_cash).toBe(400);
    expect(m.snapshot.totals.collected_during_week).toBe(0);
  });
  it('converts currencies with the FX table and records the rate', () => {
    const m = build(dataset({ invoices: [invoice({ invoice_currency: 'KRW', original_amount: 1_000_000, outstanding_amount: 1_000_000 })] }));
    expect(m.snapshot.totals.total_outstanding).toBe(700);
    expect(m.invoices[0].exchange_rate).toBe(0.0007);
    expect(m.invoices[0].exchange_rate_date).toBe(REF);
  });
  it('excludes invoices without FX rate from reporting totals and flags data quality', () => {
    const m = build(dataset({ invoices: [invoice({ invoice_currency: 'GBP' })] }));
    expect(m.snapshot.totals.total_outstanding).toBe(0);
    expect(m.data_quality.some((d) => d.code === 'MISSING_FX_RATE')).toBe(true);
  });
  it('handles missing due date as UNKNOWN bucket, not overdue', () => {
    const m = build(dataset({ invoices: [invoice({ due_date: null })] }));
    expect(m.invoices[0].aging_bucket).toBe('UNKNOWN');
    expect(m.invoices[0].is_overdue).toBe(false);
    expect(m.snapshot.totals.total_outstanding).toBe(1000);
    expect(m.snapshot.totals.overdue_outstanding).toBe(0);
    expect(m.unknown_due_reporting).toBe(1000); // reconciles total vs bucket sum
    expect(m.aging_by_bucket.reduce((s, b) => s + b.amount, 0) + m.unknown_due_reporting).toBe(m.snapshot.totals.total_outstanding);
    expect(m.customers[0].data_quality.some((d) => d.code === 'MISSING_DUE_DATE')).toBe(true);
  });
  it('caps disputed amount at outstanding and keeps it inside total', () => {
    const m = build(dataset({ invoices: [invoice({ disputed_amount: 5000, dispute_status: 'OPEN', invoice_status: 'DISPUTED' })] }));
    expect(m.snapshot.totals.disputed).toBe(1000);
    expect(m.snapshot.totals.total_outstanding).toBe(1000);
  });
});

describe('weekly flows and snapshot comparison', () => {
  it('collected this week = applied payments dated in the week (7 days ending reference)', () => {
    const m = build(dataset({ invoices: [invoice({ paid_amount: 700, outstanding_amount: 300 })], payments: [payment({ payment_date: addDays(REF, -6), applied_amount: 400 }), payment({ payment_id: 'p2', payment_date: addDays(REF, -7), applied_amount: 300 })] }));
    expect(m.week).toEqual({ start: addDays(REF, -6), end: REF });
    expect(m.snapshot.totals.collected_during_week).toBe(400);
  });
  it('week starts the day after the previous snapshot', () => {
    const prev = build(dataset(), null).snapshot;
    prev.snapshot_date = addDays(REF, -7);
    const m = build(dataset({ payments: [payment({ payment_date: addDays(REF, -6), applied_amount: 100 })] }), prev);
    expect(m.week.start).toBe(addDays(REF, -6));
    expect(m.snapshot.totals.collected_during_week).toBe(100);
  });
  it('computes new overdue and resolved overdue against the previous snapshot', () => {
    // Previous week: i1 overdue 1000, i2 not yet due 500.
    const prevDs = dataset({ invoices: [invoice(), invoice({ invoice_id: 'i2', due_date: addDays(REF, -3), original_amount: 500, outstanding_amount: 500 })] });
    const prevModel = buildTrackerModel(prevDs, { referenceDate: addDays(REF, -7), previousSnapshot: null });
    // This week: i1 paid (resolved), i2 now overdue (new).
    const nowDs = dataset({ invoices: [invoice({ paid_amount: 1000, outstanding_amount: 0, invoice_status: 'PAID' }), invoice({ invoice_id: 'i2', due_date: addDays(REF, -3), original_amount: 500, outstanding_amount: 500 })], payments: [payment({ applied_amount: 1000, payment_amount: 1000 })] });
    const m = build(nowDs, prevModel.snapshot);
    expect(m.snapshot.totals.new_overdue_during_week).toBe(500);
    expect(m.snapshot.totals.resolved_overdue_during_week).toBe(1000);
    const overdueKpi = m.kpis.find((k) => k.key === 'overdue_outstanding')!;
    expect(overdueKpi.previous).toBe(1000);
    expect(overdueKpi.change).toBe(-500);
    expect(overdueKpi.change_pct).toBeCloseTo(-0.5, 4);
  });
  it('separates FX effect from real movement', () => {
    const inv = invoice({ invoice_currency: 'JPY', original_amount: 100_000, outstanding_amount: 100_000 });
    const prevDs = dataset({ invoices: [inv], fx: { reporting_currency: 'USD', as_of: addDays(REF, -7), rates: [{ currency: 'JPY', rate_to_reporting: 0.0065, rate_date: addDays(REF, -7), source: 't' }] } });
    const prevModel = buildTrackerModel(prevDs, { referenceDate: addDays(REF, -7), previousSnapshot: null });
    const m = build(dataset({ invoices: [inv] }), prevModel.snapshot); // now rate 0.007
    expect(m.fx_effect_reporting).toBeCloseTo(100_000 * (0.007 - 0.0065), 2);
    expect(m.kpis.find((k) => k.key === 'total_outstanding')!.change).toBeCloseTo(50, 2);
  });
});

describe('promises, credit and customer aggregation', () => {
  const promise = (over: Partial<CollectionActivity> = {}): CollectionActivity => ({ activity_id: 'a1', customer_id: 'c1', invoice_id: 'i1', owner: 'Owner One', activity_type: 'PROMISE', activity_date: addDays(REF, -10), contact_channel: 'EMAIL', note: 'promise', promised_payment_date: addDays(REF, -2), promised_payment_amount: 1000, promised_currency: 'USD', next_action: null, next_action_date: null, escalation_level: 0, completed: false, ...over });
  it('flags a broken promise when less than promised was received after the promise', () => {
    const m = build(dataset({ activities: [promise()], payments: [payment({ applied_amount: 300, payment_amount: 300 })], invoices: [invoice({ paid_amount: 300, outstanding_amount: 700 })] }));
    expect(m.customers[0].promise_broken).toBe(true);
    expect(m.customers[0].broken_promise_amount_reporting).toBe(700);
    expect(m.snapshot.totals.broken_promise_count).toBe(1);
  });
  it('does not flag a promise that was kept or is still in the future', () => {
    const kept = build(dataset({ activities: [promise()], payments: [payment({ applied_amount: 1000, payment_amount: 1000 })], invoices: [invoice({ paid_amount: 1000, outstanding_amount: 0 })] }));
    expect(kept.customers[0].promise_broken).toBe(false);
    const future = build(dataset({ activities: [promise({ promised_payment_date: addDays(REF, 3) })] }));
    expect(future.customers[0].promise_broken).toBe(false);
    expect(future.customers[0].next_promise_date).toBe(addDays(REF, 3));
  });
  it('computes credit utilization in reporting currency and exceeded flag', () => {
    const m = build(dataset({ customers: [customer({ credit_limit: 800 })] }));
    expect(m.customers[0].credit_utilization).toBeCloseTo(1.25, 4);
    expect(m.customers[0].credit_limit_exceeded).toBe(true);
    expect(m.actions.some((a) => a.group === 'CREDIT_LIMIT')).toBe(true);
  });
  it('at-risk amount is the union of 30+, disputes and risky customers without double counting', () => {
    const m = build(dataset({ invoices: [invoice({ due_date: addDays(REF, -40), disputed_amount: 100, dispute_status: 'OPEN' }), invoice({ invoice_id: 'i2', due_date: addDays(REF, -2), original_amount: 200, outstanding_amount: 200 })] }));
    expect(m.snapshot.totals.at_risk_amount).toBe(1000);
  });
  it('sorts customers by risk score and exposes factor evidence', () => {
    const m = build(dataset({ customers: [customer(), customer({ customer_id: 'c2', customer_name: 'Beta' })], invoices: [invoice(), invoice({ invoice_id: 'i2', customer_id: 'c2', due_date: addDays(REF, 10) })] }));
    expect(m.customers[0].customer_id).toBe('c1');
    expect(m.customers[0].risk.factors).toHaveLength(8);
    expect(m.customers[0].risk.factors.every((f) => f.evidence.length > 0)).toBe(true);
    expect(m.customers[1].risk.score).toBe(0);
  });
});

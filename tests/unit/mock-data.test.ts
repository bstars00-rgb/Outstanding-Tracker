import { describe, expect, it } from 'vitest';
import { generateMockDataset, SCENARIOS, weeklyDates } from '@adapters/ellis/mock-data';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { validateDataset } from '@core/validate';
import { buildTrackerModel } from '@core/calc';

const REF = '2026-09-05';

describe('mock dataset', () => {
  const ds = generateMockDataset(REF);
  it('meets minimum volumes', () => {
    expect(ds.customers.length).toBeGreaterThanOrEqual(30);
    expect(ds.invoices.length).toBeGreaterThanOrEqual(150);
    expect(weeklyDates(REF, 12)).toHaveLength(12);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(generateMockDataset(REF))).toBe(JSON.stringify(generateMockDataset(REF)));
  });
  it('passes schema validation (only non-blocking DQ issues)', () => {
    const v = validateDataset(ds);
    expect(v.ok).toBe(true);
    expect(v.issues.some((i) => i.code === 'MISSING_DUE_DATE')).toBe(true);
    expect(v.issues.some((i) => i.code === 'MISSING_OWNER')).toBe(true);
  });
  it('contains no guest / personal data fields', () => {
    const text = JSON.stringify(ds).toLowerCase();
    expect(text).not.toMatch(/guestname|guest_name|passport|phone_number|email_address/);
  });
  it('covers every required scenario', () => {
    const required = ['GOOD_LARGE_NOT_DUE', 'LONG_OVERDUE', 'OVER_90', 'BROKEN_PROMISE', 'DISPUTE', 'CREDIT_NOTE', 'PARTIAL_PAYMENT', 'CREDIT_LIMIT_EXCEEDED', 'RECENTLY_COLLECTED', 'SHARP_DETERIORATION', 'MISSING_DATA', 'CANCELLED_BOOKING', 'REFUND_UNAPPLIED', 'MULTI_CURRENCY', 'NORMAL_NOT_DUE'];
    for (const s of required) expect(SCENARIOS.some((x) => x.scenario === s)).toBe(true);
    const currencies = new Set(ds.invoices.map((i) => i.invoice_currency));
    expect(currencies.size).toBeGreaterThanOrEqual(6);
    expect(ds.invoices.some((i) => i.cancellation_status === 'CANCELLED')).toBe(true);
    expect(ds.invoices.some((i) => i.credit_note_amount > 0)).toBe(true);
    expect(ds.invoices.some((i) => i.disputed_amount > 0)).toBe(true);
    expect(ds.invoices.some((i) => i.due_date === null)).toBe(true);
    expect(ds.payments.some((p) => p.reconciliation_status === 'REFUNDED')).toBe(true);
    expect(ds.payments.some((p) => p.unapplied_amount > 0)).toBe(true);
  });
  it('scenario customers behave as designed in the calculated model', async () => {
    const src = new MockReceivablesSource();
    const prev = await src.previousSnapshot(REF);
    const m = buildTrackerModel(ds, { referenceDate: REF, previousSnapshot: prev });
    const byName = (n: string) => m.customers.find((c) => c.customer_name === n)!;
    expect(byName('Hanbit Tours Co.').overdue_reporting).toBe(0);
    expect(byName('Hanbit Tours Co.').risk.grade).toBe('Low');
    expect(byName('Mekong Holidays JSC').max_aging_days).toBeGreaterThan(90);
    expect(['High', 'Critical']).toContain(byName('Mekong Holidays JSC').risk.grade);
    expect(byName('Formosa Travel Hub').promise_broken).toBe(true);
    expect(byName('Siam Getaways Ltd.').disputed_reporting).toBeGreaterThan(0);
    expect(byName('Nusantara Trips PT').credit_limit_exceeded).toBe(true);
    expect(byName('Fuji Peak Travel Inc.').wow_overdue_change_reporting!).toBeGreaterThan(50_000);
    expect(byName('Kimchi & Go Travel').last_payment_date! >= m.week.start).toBe(true);
    expect(byName('Saigon Sky Tours').account_owner_name).toBe('Unassigned');
    expect(byName('Saigon Sky Tours').credit_utilization).toBeNull();
    expect(m.snapshot.totals.unapplied_cash).toBeGreaterThan(0);
    expect(m.snapshot.totals.credit_notes_applied).toBeGreaterThan(0);
    expect(m.previous_snapshot_date).toBe('2026-08-29');
  });
  it('produces 12 chained weekly snapshots with FX drift', async () => {
    const src = new MockReceivablesSource();
    const h = await src.history(REF, 12);
    expect(h).toHaveLength(12);
    expect(h[0].date).toBe('2026-06-20');
    expect(h[11].date).toBe(REF);
    expect(h[0].snapshot.fx.rates.find((r) => r.currency === 'USD')!.rate_to_reporting).not.toBe(h[11].snapshot.fx.rates.find((r) => r.currency === 'USD')!.rate_to_reporting);
    for (const p of h) expect(p.snapshot.totals.total_outstanding).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { FixtureReceivablesSource } from '../fixtures/fixture-source';
import { buildTrackerModel } from '@core/calc';
import { DEFAULT_REFLECTION_CHAIN } from '@core/types';

const REF = '2026-09-05';
const src = new FixtureReceivablesSource();
const ds = await src.fetchDataset(REF);
const model = buildTrackerModel(ds, { referenceDate: REF, previousSnapshot: await src.previousSnapshot(REF), lang: 'ko' });

describe('CEO feedback: managing entity split and ELLIS reflection chain', () => {
  it('splits receivables by managing entity (Seoul / Singapore) and reconciles to the total', () => {
    const labels = model.aging_by_control_company.map((d) => d.label);
    expect(labels).toEqual(expect.arrayContaining(['OMH Seoul', 'OMH Singapore']));
    const sum = model.aging_by_control_company.reduce((s, d) => s + d.total, 0);
    expect(Math.abs(sum - model.snapshot.totals.total_outstanding)).toBeLessThan(1);
    expect(model.snapshot.control_companies.length).toBe(model.aging_by_control_company.length);
    expect(model.customers.find((c) => c.customer_name === 'Saigon Sky Tours')!.control_company).toBeNull(); // missing-data scenario => "법인 미지정"
  });
  it('queues payments through record -> verify -> reconcile with owners and SLA flags', () => {
    const q = model.reflection_queue;
    expect(q.length).toBeGreaterThan(0);
    const recorded = q.filter((r) => r.stage === 'RECORDED');
    const verified = q.filter((r) => r.stage === 'VERIFIED');
    expect(recorded.every((r) => r.next_owner === DEFAULT_REFLECTION_CHAIN.verify.owner)).toBe(true);
    expect(verified.every((r) => r.next_owner === DEFAULT_REFLECTION_CHAIN.reconcile.owner)).toBe(true);
    expect(q.some((r) => r.stage === 'RECORDED' && r.overdue_sla)).toBe(true); // Lion City payment recorded but never verified
    expect(q.some((r) => r.stage === 'VERIFIED' && r.overdue_sla)).toBe(true); // Harbour Lights payment verified but not reconciled
    expect(q.filter((r) => r.stage === 'RECONCILED').every((r) => r.next_owner === '' && !r.overdue_sla)).toBe(true);
  });
  it('exposes unverified / unreconciled totals and action items for the chain owners', () => {
    const t = model.snapshot.totals;
    expect(t.unverified_payment_count + t.unreconciled_payment_count).toBeGreaterThan(0);
    const items = model.actions.filter((a) => a.group === 'ELLIS_REFLECTION');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((a) => ['Sangho', 'Management Support (TBD)'].includes(a.owner))).toBe(true);
    expect(items[0].recommended_action).toMatch(/ELLIS 검증|은행 입금 대사/);
  });
  it('stage RECEIVED: money at the bank but not in ELLIS goes to the record owner and always raises an action', () => {
    const inv = ds.invoices.find((i) => i.outstanding_amount > 0)!;
    const ds2 = { ...ds, payments: [...ds.payments, { payment_id: 'recv-1', invoice_id: inv.invoice_id, customer_id: inv.customer_id, payment_date: REF, payment_amount: 1000, payment_currency: inv.invoice_currency, applied_amount: 1000, unapplied_amount: 0, payment_method: 'BANK_TRANSFER' as const, payment_reference: 'OP note', reconciliation_status: 'APPLIED' as const, recorded_at: null, confirmed_at: null, reconciled_at: null, data_source: 'test' }] };
    const m2 = buildTrackerModel(ds2, { referenceDate: REF, previousSnapshot: null, lang: 'ko' });
    const item = m2.reflection_queue[0];
    expect(item.stage).toBe('RECEIVED');
    expect(item.payment_id).toBe('recv-1');
    expect(item.invoice_id).toBe(inv.invoice_id);
    expect(item.next_owner).toBe(DEFAULT_REFLECTION_CHAIN.record.owner);
    expect(item.overdue_sla).toBe(false); // received today: inside the record SLA
    expect(m2.snapshot.totals.unrecorded_payment_count).toBe(1);
    expect(m2.snapshot.totals.unverified_payment_count).toBe(model.snapshot.totals.unverified_payment_count); // not double-counted as "unverified"
    const act = m2.actions.find((x) => x.id === 'ELLIS_REFLECTION:recv-1')!;
    expect(act.owner).toBe(DEFAULT_REFLECTION_CHAIN.record.owner);
    expect(act.recommended_action).toMatch(/ELLIS에 입금 기록/);
  });
  it('language does not change the queue', () => {
    const en = buildTrackerModel(ds, { referenceDate: REF, previousSnapshot: null, lang: 'en' });
    expect(en.reflection_queue.map((r) => [r.payment_id, r.stage, r.days_in_stage])).toEqual(model.reflection_queue.map((r) => [r.payment_id, r.stage, r.days_in_stage]));
  });
});

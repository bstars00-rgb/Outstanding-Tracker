import { describe, expect, it } from 'vitest';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { buildTrackerModel } from '@core/calc';
import { DEFAULT_REFLECTION_CHAIN } from '@core/types';

const REF = '2026-09-05';
const src = new MockReceivablesSource();
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
    expect(items.every((a) => ['Sangho', 'Jackie'].includes(a.owner))).toBe(true);
    expect(items[0].recommended_action).toMatch(/ELLIS 검증|은행 입금 대사/);
  });
  it('language does not change the queue', () => {
    const en = buildTrackerModel(ds, { referenceDate: REF, previousSnapshot: null, lang: 'en' });
    expect(en.reflection_queue.map((r) => [r.payment_id, r.stage, r.days_in_stage])).toEqual(model.reflection_queue.map((r) => [r.payment_id, r.stage, r.days_in_stage]));
  });
});

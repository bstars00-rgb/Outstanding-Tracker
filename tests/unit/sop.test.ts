import { describe, expect, it } from 'vitest';
import { assessSop, DEFAULT_SOP_CONFIG } from '@core/sop';
import { addMonths } from '@core/dates';
import { buildTrackerModel } from '@core/calc';
import { FixtureReceivablesSource } from '../fixtures/fixture-source';
import { buildInsightInput } from '@adapters/ai/insight-input';
import { generateRuleBasedInsight } from '@adapters/ai/mock-provider';
import { verifyInsight } from '@adapters/ai/verify';

const ref = '2026-09-28';

describe('OMH SOP urgency levels (src/core/sop.ts)', () => {
  const base = { is_overdue: true, due_date: '2026-09-18', referenceDate: ref };
  it('L1 = Tier 1 and >= ¥1M, routed to CEO', () => {
    const r = assessSop({ ...base, tier: 1, amount_jpy: 12_757_968 });
    expect(r.level).toBe('L1');
    expect(r.route).toBe('CEO');
    expect(r.tier_deadline).toBe('2027-03-18'); // due + 6 months, as the OP workbook computes it
    expect(r.past_tier_deadline).toBe(false);
  });
  it('L2 for Tier 1 below ¥1M and (assumed) Tier 2 above ¥500K; route follows the ¥500K rule', () => {
    expect(assessSop({ ...base, tier: 1, amount_jpy: 153_460 })).toMatchObject({ level: 'L2', route: 'LOCAL_DIRECTOR' });
    expect(assessSop({ ...base, tier: 1, amount_jpy: 700_000 })).toMatchObject({ level: 'L2', route: 'CEO' });
    expect(assessSop({ ...base, tier: 2, amount_jpy: 18_039_056 })).toMatchObject({ level: 'L2', route: 'CEO' });
    expect(assessSop({ ...base, tier: 2, amount_jpy: 18_039_056 }).rule).toMatch(/assumed/);
  });
  it('L3 for Tier 2 <= ¥500K, Tier 3 and untiered; L4 below ¥100K regardless of tier', () => {
    expect(assessSop({ ...base, tier: 2, amount_jpy: 200_000 }).level).toBe('L3');
    expect(assessSop({ ...base, tier: 3, amount_jpy: 4_832_513 })).toMatchObject({ level: 'L3', route: 'CEO', tier_deadline: '2026-12-18' });
    expect(assessSop({ ...base, tier: null, amount_jpy: 2_822_314 })).toMatchObject({ level: 'L3', tier_deadline: null });
    expect(assessSop({ ...base, tier: 1, amount_jpy: 47_542 }).level).toBe('L4');
    expect(assessSop({ ...base, tier: 3, amount_jpy: 99_999 }).level).toBe('L4');
  });
  it('no level when not overdue or when the amount cannot be expressed in JPY', () => {
    expect(assessSop({ ...base, is_overdue: false, tier: 1, amount_jpy: 5_000_000 })).toMatchObject({ level: null, route: null, rule: 'not overdue' });
    expect(assessSop({ ...base, tier: 1, amount_jpy: null })).toMatchObject({ level: null, rule: 'no JPY rate' });
  });
  it('flags items past their Tier collection period (probability checklist due)', () => {
    const r = assessSop({ tier: 3, amount_jpy: 600_000, is_overdue: true, due_date: '2026-06-01', referenceDate: ref }, DEFAULT_SOP_CONFIG);
    expect(r.tier_deadline).toBe('2026-09-01');
    expect(r.past_tier_deadline).toBe(true);
  });
  it('addMonths keeps the day of month and clamps at month end', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
  });
});

describe('SOP in the model, actions, insight and verification', () => {
  it('classifies every open overdue invoice, sums by level and raises CEO decisions for L1', async () => {
    const ds = await new FixtureReceivablesSource().fetchDataset(ref);
    // Give the mock customers tiers so the SOP applies (mock master data is untiered by default).
    ds.customers.forEach((c, n) => (c.tier = ((n % 3) + 1) as 1 | 2 | 3));
    const m = buildTrackerModel(ds, { referenceDate: ref, previousSnapshot: null, lang: 'ko' });
    const open = m.invoices.filter((i) => i.outstanding_amount > 0);
    for (const i of open) {
      if (i.is_overdue) expect(i.sop.level).not.toBeNull();
      else expect(i.sop.level).toBeNull();
      if (i.sop.level) expect(i.sop.amount_jpy).toBeGreaterThan(0);
    }
    const levelSum = m.sop_summary.reduce((s, r) => s + r.amount, 0);
    const overdueSum = open.filter((i) => i.is_overdue && i.sop.level).reduce((s, i) => s + i.outstanding_reporting, 0);
    expect(Math.abs(levelSum - overdueSum)).toBeLessThan(1);
    const l1 = open.filter((i) => i.sop.level === 'L1');
    expect(l1.length).toBeGreaterThan(0);
    for (const i of l1) expect(m.actions.some((a) => a.id === `SOP_L1:${i.invoice_id}` && a.severity === 'critical')).toBe(true);

    const input = buildInsightInput(m);
    expect(input.sop_l1.length).toBeGreaterThan(0);
    const out = generateRuleBasedInsight(input, 'ko');
    expect(out.ceo_decisions.some((d) => d.topic.startsWith('SOP L1'))).toBe(true);
    expect(out.executive_summary[0]).not.toContain('없음했습니다');
    expect(verifyInsight(input, out).ok).toBe(true);
  });
});

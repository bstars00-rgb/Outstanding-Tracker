import { describe, expect, it } from 'vitest';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { buildTrackerModel } from '@core/calc';
import { buildInsightInput } from '@adapters/ai/insight-input';
import { generateRuleBasedInsight, RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import { extractNumbers, verifyInsight, sanitizeInsight, emptyOutput } from '@adapters/ai/verify';
import { generateInsight } from '@adapters/ai/insight-service';
import type { InsightOutput, InsightProvider } from '@adapters/ai/types';

const REF = '2026-09-05';
const src = new MockReceivablesSource();
const model = buildTrackerModel(await src.fetchDataset(REF), { referenceDate: REF, previousSnapshot: await src.previousSnapshot(REF) });
const input = buildInsightInput(model);

describe('insight input', () => {
  it('contains only computed figures, no invoice ids or notes', () => {
    const text = JSON.stringify(input);
    expect(text).not.toMatch(/INV-2026|inv-1\d\d\d|payment_reference|"note"/);
    expect(input.kpis).toHaveLength(10);
    expect(input.top_overdue_customers.length).toBeGreaterThan(0);
  });
});

describe('rule-based insight passes verification', () => {
  it('verifies every number and name', () => {
    const out = generateRuleBasedInsight(input);
    const v = verifyInsight(input, out);
    expect(v.ok).toBe(true);
    expect(v.checked_numbers).toBeGreaterThan(10);
    expect(out.executive_summary.length).toBeGreaterThanOrEqual(2);
    expect(out.top_risks.length).toBeGreaterThan(0);
    expect(out.owner_actions.length).toBeGreaterThan(0);
    expect(out.forecast_next_week.currency).toBe('JPY');
  });
});

describe('verification catches hallucinations', () => {
  it('extracts numbers with K/M and percent, skipping dates and years', () => {
    expect(extractNumbers('USD 428,000 rose 12.5% (2026-09-05) by 37K and 1.2M in 2026')).toEqual([428000, 12.5, 37000, 1200000]);
  });
  it('flags fabricated amounts and unknown customers', () => {
    const bad: InsightOutput = { ...emptyOutput('USD'), executive_summary: ['Overdue is USD 999,999,999 for Nonexistent Corp'], top_risks: [{ customer: 'Nonexistent Corp', owner: 'Ghost Owner', amount: 123456789, reason: 'x', action: 'y', due: '2026-09-07' }] };
    const v = verifyInsight(input, bad);
    expect(v.ok).toBe(false);
    expect(v.unverified_numbers.length).toBeGreaterThan(0);
    expect(v.unknown_customers.map((c) => c.name)).toContain('Nonexistent Corp');
    expect(v.unknown_owners.map((c) => c.name)).toContain('Ghost Owner');
  });
  it('sanitization removes only the unverifiable items', () => {
    const good = generateRuleBasedInsight(input);
    const mixed: InsightOutput = { ...good, executive_summary: [...good.executive_summary, 'Fabricated: USD 777,777,777 lost'] };
    const { output, removed } = sanitizeInsight(input, mixed);
    expect(removed).toContain(`executive_summary[${good.executive_summary.length}]`);
    expect(output.executive_summary).toEqual(good.executive_summary);
    expect(verifyInsight(input, output).ok).toBe(true);
  });
});

describe('insight service fallback', () => {
  it('falls back to rule-based when the provider throws', async () => {
    const failing: InsightProvider = { name: 'failing', generate: async () => { throw new Error('boom'); } };
    const r = await generateInsight(model, { provider: failing });
    expect(r.fallback_used).toBe(true);
    expect(r.provider).toBe('rule-based');
    expect(r.verification.ok).toBe(true);
    expect(r.error).toMatch(/boom/);
  });
  it('keeps verified model output and sanitizes hallucinated parts', async () => {
    const hallucinating: InsightProvider = { name: 'halluc', generate: async (i) => ({ output: { ...generateRuleBasedInsight(i), ceo_decisions: [{ topic: 'Fake', customer: 'Imaginary Ltd', amount: 5_555_555, recommendation: 'x', rationale: 'y' }] }, model: 'fake-model' }) };
    const r = await generateInsight(model, { provider: hallucinating });
    expect(r.fallback_used).toBe(false);
    expect(r.output.ceo_decisions.some((d) => d.customer === 'Imaginary Ltd')).toBe(false);
    expect(r.verification.ok).toBe(true);
    expect(r.verification.notes.join(' ')).toMatch(/ceo_decisions\[0\]/);
  });
  it('uses the rule-based provider directly in mock mode', async () => {
    const r = await generateInsight(model, { provider: new RuleBasedInsightProvider() });
    expect(r.provider).toBe('rule-based');
    expect(r.fallback_used).toBe(false);
  });
});

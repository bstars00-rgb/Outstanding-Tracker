import { describe, expect, it } from 'vitest';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { buildTrackerModel } from '@core/calc';
import { buildInsightInput } from '@adapters/ai/insight-input';
import { generateRuleBasedInsight, RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import { verifyInsight } from '@adapters/ai/verify';
import { generateInsight } from '@adapters/ai/insight-service';
import { buildTeamsMessage } from '@adapters/teams/message-builder';

const REF = '2026-09-05';
const src = new MockReceivablesSource();
const ds = await src.fetchDataset(REF);
const prev = await src.previousSnapshot(REF);
const en = buildTrackerModel(ds, { referenceDate: REF, previousSnapshot: prev, lang: 'en' });
const ko = buildTrackerModel(ds, { referenceDate: REF, previousSnapshot: prev, lang: 'ko' });

describe('bilingual engine text', () => {
  it('language never changes any number', () => {
    expect(ko.kpis.map((k) => [k.value, k.previous, k.change])).toEqual(en.kpis.map((k) => [k.value, k.previous, k.change]));
    expect(ko.customers.map((c) => [c.customer_id, c.risk.score, c.overdue_reporting])).toEqual(en.customers.map((c) => [c.customer_id, c.risk.score, c.overdue_reporting]));
    expect(ko.snapshot.totals).toEqual(en.snapshot.totals);
    expect(ko.lang).toBe('ko');
    expect(en.lang).toBe('en');
  });
  it('KPI labels, risk evidence and recommended actions are Korean in ko mode', () => {
    expect(ko.kpis.find((k) => k.key === 'total_outstanding')!.label).toBe('총 미수금');
    expect(en.kpis.find((k) => k.key === 'total_outstanding')!.label).toBe('Total Outstanding');
    const mekong = ko.customers.find((c) => c.customer_name === 'Mekong Holidays JSC')!;
    expect(mekong.risk.factors[0].label).toBe('연체 일수');
    expect(mekong.risk.factors[0].evidence).toMatch(/최장 연체 Invoice: \d+일/);
    expect(mekong.recommended_action).toMatch(/Finance 리더/);
    expect(ko.actions.some((a) => /리마인더|통지|보류/.test(a.recommended_action))).toBe(true);
  });
  it('Korean rule-based insight passes the same number/name verification', () => {
    const input = buildInsightInput(ko);
    const out = generateRuleBasedInsight(input, 'ko');
    const v = verifyInsight(input, out);
    expect(v.ok).toBe(true);
    expect(out.executive_summary[0]).toMatch(/총 미수금은 JPY/);
    expect(out.top_risks[0].reason).toMatch(/위험 (높음|심각|중간|관찰|낮음)/);
    expect(out.forecast_next_week.basis[0]).toMatch(/다음 주 만기 Invoice/);
  });
  it('Teams card and markdown use Korean headings and JPY when REPORT_LANGUAGE=ko', async () => {
    const insight = await generateInsight(ko, { provider: new RuleBasedInsightProvider('ko'), lang: 'ko' });
    const msg = buildTeamsMessage(ko, insight, { trackerBaseUrl: 'https://x.example/', timeZone: 'Asia/Ho_Chi_Minh', sentAt: `${REF}T02:00:00.000Z`, channelLabel: 'leaders', lang: 'ko' });
    expect(msg.title).toBe('[주간 미수금 보고] 2026-09-05 (MOCK 데이터)');
    const body = JSON.stringify(msg.card.body);
    for (const s of ['1. 경영 요약', '2. AI 인사이트', '3. 필수 조치', '4. CEO 의사결정 필요', '보고 통화 JPY', '자동 생성 보고서']) expect(body).toContain(s);
    expect(msg.markdown).toContain('**5. 링크**');
    expect(msg.markdown).toContain('?lang=ko');
    expect(msg.markdown_length).toBeLessThanOrEqual(3500);
  });
  it('reporting currency can still be switched (USD) and the risk thresholds scale with it', () => {
    const usdSrc = new MockReceivablesSource(20260905, 'USD');
    return usdSrc.fetchDataset(REF).then(async (dsUsd) => {
      const m = buildTrackerModel(dsUsd, { referenceDate: REF, previousSnapshot: await usdSrc.previousSnapshot(REF) });
      expect(m.reporting_currency).toBe('USD');
      const mekongUsd = m.customers.find((c) => c.customer_name === 'Mekong Holidays JSC')!;
      const mekongJpy = en.customers.find((c) => c.customer_name === 'Mekong Holidays JSC')!;
      // thresholds are scaled to the reporting currency => amount factor and grade do not depend on the reporting currency
      expect(mekongUsd.risk.factors[1].points).toBe(mekongJpy.risk.factors[1].points);
      expect(mekongUsd.risk.grade).toBe(mekongJpy.risk.grade);
      expect(mekongJpy.totals_by_currency[0].currency).toBe('VND');
      expect(mekongJpy.totals_by_currency[0].total).toBeGreaterThan(mekongJpy.total_outstanding_reporting); // VND amounts are larger than JPY equivalents
    });
  });
});

import { describe, expect, it } from 'vitest';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { buildTrackerModel } from '@core/calc';
import { generateInsight } from '@adapters/ai/insight-service';
import { RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import { buildFailureMessage, buildTeamsMessage } from '@adapters/teams/message-builder';

const REF = '2026-09-05';
const src = new MockReceivablesSource();
const model = buildTrackerModel(await src.fetchDataset(REF), { referenceDate: REF, previousSnapshot: await src.previousSnapshot(REF) });
const insight = await generateInsight(model, { provider: new RuleBasedInsightProvider() });
const ctx = { trackerBaseUrl: 'https://example.github.io/tracker/', timeZone: 'Asia/Ho_Chi_Minh', sentAt: '2026-09-05T02:00:00.000Z', channelLabel: 'leaders' as const };

describe('Teams message', () => {
  const msg = buildTeamsMessage(model, insight, ctx);
  it('has the required title and idempotency key', () => {
    expect(msg.title).toBe('[Weekly Outstanding Report] 2026-09-05 (MOCK DATA)');
    expect(msg.idempotency_key).toBe('weekly-outstanding:2026-09-05:leaders');
  });
  it('is a valid Adaptive Card 1.4 with the six sections and three links', () => {
    expect(msg.card.type).toBe('AdaptiveCard');
    expect(msg.card.version).toBe('1.4');
    const texts = JSON.stringify(msg.card.body);
    for (const s of ['1. Executive Summary', '2. AI Insights', '3. Required Actions', '4. CEO Decision Required', 'Data as of', 'Reporting currency USD', 'Automated report']) expect(texts).toContain(s);
    expect(msg.card.actions).toHaveLength(3);
    expect(JSON.stringify(msg.card.actions)).toContain('#/customers');
  });
  it('shows data timestamp and send timestamp in the report timezone', () => {
    const footer = JSON.stringify(msg.card.body);
    expect(footer).toMatch(/Data as of 2026-09-05 09:00 GMT\+7/);
    expect(footer).toMatch(/Sent 2026-09-05 09:00 GMT\+7/);
    expect(footer).toContain('Compared with 2026-08-29');
  });
  it('markdown fallback stays within the mobile length budget and has links', () => {
    expect(msg.markdown_length).toBeLessThanOrEqual(3500);
    expect(msg.markdown).toContain('**1. Executive Summary**');
    expect(msg.markdown).toContain('[Tracker](https://example.github.io/tracker/#/)');
  });
  it('contains no invoice numbers or personal data', () => {
    const all = JSON.stringify(msg);
    expect(all).not.toMatch(/INV-2026-\d+/);
    expect(all).not.toMatch(/guest/i);
  });
  it('failure message never carries figures', () => {
    const f = buildFailureMessage(REF, 'Ellis MCP timeout', ctx);
    expect(f.title).toContain('Data refresh failed');
    expect(JSON.stringify(f.card)).not.toMatch(/USD \d/);
    expect(f.idempotency_key).toContain(':failure');
  });
});

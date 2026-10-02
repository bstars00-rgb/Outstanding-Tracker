import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { buildFixtureModel } from '../fixtures/fixture-model';

const require = createRequire(import.meta.url);
const { buildCard, money } = require('../../automation/teams-graph/post-weekly.cjs') as { buildCard: (m: unknown, i: unknown, o: { siteUrl: string; test?: boolean }) => any; money: (n: number, c: string) => string };

describe('Teams (Graph) weekly card', () => {
  it('is concise, carries the key figures and links to the published site', async () => {
    const { model, insight } = await buildFixtureModel('2026-09-05', { lang: 'ko' });
    const card = buildCard(model, insight, { siteUrl: 'https://example.github.io/tracker' });
    expect(card.type).toBe('AdaptiveCard');
    const json = JSON.stringify(card);
    expect(json.length).toBeLessThan(6000); // Teams message limit is ~28 KB; the card must stay a summary
    expect(card.body.length).toBeLessThanOrEqual(10);
    expect(json).toContain(money(model.kpis.find((k) => k.key === 'total_outstanding')!.value, 'JPY'));
    expect(json).toContain('WoW');
    expect(card.actions.map((a: any) => a.type)).toEqual(['Action.OpenUrl', 'Action.OpenUrl', 'Action.OpenUrl']);
    expect(card.actions[0].url).toBe('https://example.github.io/tracker/#/?lang=ko');
    expect(json).not.toContain('테스트 발송');
    // no invoice-level detail or customer ledgers in the chat card: at most the 3 action lines name customers
    expect((json.match(/기한 \d{4}-\d{2}-\d{2}/g) ?? []).length).toBeLessThanOrEqual(3);
  });

  it('shows the access password only when the operator opted in', async () => {
    const { model, insight } = await buildFixtureModel('2026-09-05', { lang: 'ko' });
    const without = JSON.stringify(buildCard(model, insight, { siteUrl: 'https://x/' }));
    expect(without).toContain('접속 비밀번호 필요');
    expect(without).not.toContain('트래커 접속 비밀번호:');
    const withPw = JSON.stringify(buildCard(model, insight, { siteUrl: 'https://x/', password: 'Sample-Pass-123' } as any));
    expect(withPw).toContain('트래커 접속 비밀번호: Sample-Pass-123');
    expect(withPw).toContain('외부 공유 금지');
  });

  it('marks test posts and formats money compactly', async () => {
    const { model, insight } = await buildFixtureModel('2026-09-05', { lang: 'ko' });
    expect(JSON.stringify(buildCard(model, insight, { siteUrl: 'https://x/', test: true }))).toContain('[테스트 발송]');
    expect(money(481_578_225, 'JPY')).toBe('¥481.6M');
    expect(money(687_157, 'JPY')).toBe('¥687K');
    expect(money(-181_315_326, 'JPY')).toBe('−¥181.3M');
    expect(money(12_757_968, 'JPY')).toBe('¥12.76M');
  });
});

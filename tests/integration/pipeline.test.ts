import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPipeline, type PipelineDeps } from '../../automation/weekly-report';
import { loadEnv } from '../../automation/lib/env';
import { RedactingLogger } from '../../automation/lib/logger';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { MockTeamsSender } from '@adapters/teams/mock-sender';
import { RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import { InMemorySnapshotStore } from '@adapters/storage/snapshot-store';
import { FileSnapshotStore } from '@adapters/storage/file-snapshot-store';
import type { ReceivablesSource } from '@adapters/ellis/types';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ot-pipe-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deps(over: Partial<PipelineDeps> = {}, env: NodeJS.ProcessEnv = {}): PipelineDeps & { sender: MockTeamsSender } {
  const log = new RedactingLogger(() => {});
  const sender = new MockTeamsSender();
  return {
    env: loadEnv({ REPORT_DATE: '2026-09-05', TRACKER_BASE_URL: 'https://example.github.io/t/', ...env }),
    source: new MockReceivablesSource(),
    store: new InMemorySnapshotStore(),
    insightProvider: new RuleBasedInsightProvider(),
    sender,
    log,
    now: () => new Date('2026-09-05T02:00:00Z'),
    outDir: join(dir, 'out'),
    ...over,
  } as PipelineDeps & { sender: MockTeamsSender };
}

describe('weekly pipeline (mock end-to-end)', () => {
  it('DRY_RUN writes preview files, saves snapshot and receipt, sends nothing', async () => {
    const d = deps();
    const r = await runPipeline(d);
    expect(r.status).toBe('dry-run');
    expect(r.files).toEqual(expect.arrayContaining(['tracker-model.json', 'insight.json', 'teams-message.json', 'teams-message.md', 'snapshot.json']));
    expect(d.sender.sent).toHaveLength(0);
    const card = JSON.parse(await readFile(join(d.outDir, 'teams-message.json'), 'utf8'));
    expect(card.type).toBe('AdaptiveCard');
    expect(await d.store.getSnapshot('2026-09-05')).not.toBeNull();
    // previous snapshots were seeded from mock history so WoW exists
    expect(r.model!.previous_snapshot_date).toBe('2026-08-29');
    const receipt = await d.store.getReceipt('weekly-outstanding:2026-09-05:test');
    expect(receipt?.dry_run).toBe(true);
    const published = JSON.parse(await readFile(join(d.outDir, 'tracker-model.json'), 'utf8'));
    expect(JSON.stringify(published)).not.toMatch(/TT-\d{6}/); // payment references stripped
  });

  it('DRY_RUN=false sends once to the target channel and is idempotent on re-run', async () => {
    const d = deps({}, { DRY_RUN: 'false', TARGET_CHANNEL: 'test' });
    const r1 = await runPipeline(d);
    expect(r1.status).toBe('sent');
    expect(d.sender.sent).toHaveLength(1);
    expect(d.sender.sent[0].channel).toBe('test');
    expect(d.sender.sent[0].message.idempotency_key).toBe('weekly-outstanding:2026-09-05:test');
    const r2 = await runPipeline(d);
    expect(r2.status).toBe('skipped-duplicate');
    expect(d.sender.sent).toHaveLength(1);
    const r3 = await runPipeline({ ...d, forceResend: true });
    expect(r3.status).toBe('sent');
    expect(d.sender.sent).toHaveLength(2);
  });

  it('leaders channel only when explicitly targeted', async () => {
    const d = deps({}, { DRY_RUN: 'false', TARGET_CHANNEL: 'leaders' });
    const r = await runPipeline(d);
    expect(r.status).toBe('sent');
    expect(d.sender.sent[0].channel).toBe('leaders');
  });

  it('data refresh failure sends a failure message + admin alert, never stale figures', async () => {
    const failing: ReceivablesSource = { name: 'broken', kind: 'ellis-mcp', fetchDataset: async () => { throw new Error('MCP timeout'); }, healthCheck: async () => ({ ok: false, detail: 'x' }) };
    const d = deps({ source: failing }, { DRY_RUN: 'false' });
    const r = await runPipeline(d);
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/Data refresh failed: MCP timeout/);
    expect(d.sender.sent).toHaveLength(1);
    expect(d.sender.sent[0].message.title).toContain('Data refresh failed');
    expect(JSON.stringify(d.sender.sent[0].message.card)).not.toMatch(/USD \d/);
    expect(d.sender.alerts).toHaveLength(1);
    expect(await d.store.getSnapshot('2026-09-05')).toBeNull();
  });

  it('schema validation failure is treated as a failure, not reported as data', async () => {
    const bad: ReceivablesSource = { name: 'bad', kind: 'ellis-mcp', fetchDataset: async () => { const ds = await new MockReceivablesSource().fetchDataset('2026-09-05'); return { ...ds, invoices: [...ds.invoices, { ...ds.invoices[0], invoice_id: 'zz', customer_id: 'ghost' }] }; }, healthCheck: async () => ({ ok: true, detail: '' }) };
    const d = deps({ source: bad }, { DRY_RUN: 'false' });
    const r = await runPipeline(d);
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/validation failed/);
    expect(d.sender.alerts[0]).toMatch(/FAILED/);
  });

  it('Teams send failure after retries raises an admin alert', async () => {
    const d = deps({}, { DRY_RUN: 'false' });
    d.sender.failuresBeforeSuccess = 99;
    const r = await runPipeline(d);
    expect(r.status).toBe('failed');
    expect(d.sender.alerts[0]).toMatch(/Teams send/);
    // snapshot still persisted so the next run compares correctly
    expect(await d.store.getSnapshot('2026-09-05')).not.toBeNull();
  });

  it('works with the file-based snapshot store (round trip on disk)', async () => {
    const store = new FileSnapshotStore(join(dir, 'state'));
    const d = deps({ store });
    await runPipeline(d);
    const files = await readdir(join(dir, 'state', 'snapshots'));
    expect(files.length).toBe(12); // 11 seeded + current
    expect(await store.getPreviousSnapshot('2026-09-05')).toMatchObject({ snapshot_date: '2026-08-29' });
    const d2 = deps({ store }, { REPORT_DATE: '2026-09-12' });
    const r2 = await runPipeline(d2);
    expect(r2.model!.previous_snapshot_date).toBe('2026-09-05');
  });

  it('logs never contain secrets', async () => {
    const lines: string[] = [];
    const log = new RedactingLogger((l) => lines.push(l));
    log.protect('https://prod.logic.azure.com/workflows/SECRET123');
    const d = deps({ log }, { TEAMS_WEBHOOK_URL: 'https://prod.logic.azure.com/workflows/SECRET123' });
    await runPipeline(d);
    expect(lines.join('\n')).not.toContain('SECRET123');
    expect(lines.some((l) => l.includes('[1/13]'))).toBe(true);
  });
});

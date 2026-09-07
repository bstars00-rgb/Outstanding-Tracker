/**
 * Weekly Outstanding Report pipeline (runs every Saturday 09:00 Asia/Ho_Chi_Minh via GitHub Actions).
 *
 *  1. resolve report date            7. Risk Score (inside buildTrackerModel)
 *  2. idempotency check              8. AI insight (provider + fallback)
 *  3. fetch data (with retry)        9. re-verify AI numbers vs computed input
 *  4. schema validation             10. build Teams message (Adaptive Card + Markdown)
 *  5. dedupe + FX conversion        11. send (DRY_RUN => files only)
 *  6. calc outstanding/aging + WoW  12. persist snapshot + receipt; 13. alert on failure
 *
 * Exit codes: 0 success/skipped, 1 failure (workflow retries once, then alerts admin).
 */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildTrackerModel } from '@core/calc';
import { latestSaturday, tzOffsetMinutes } from '@core/dates';
import { validateDataset } from '@core/validate';
import type { ReceivablesDataset, Snapshot, TrackerModel } from '@core/types';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { EllisMcpReceivablesSource } from '@adapters/ellis/live-adapter';
import { HttpMcpClient } from '@adapters/ellis/mcp-client';
import type { ReceivablesSource } from '@adapters/ellis/types';
import { mockFxTable } from '@adapters/ellis/mock-data';
import { generateInsight } from '@adapters/ai/insight-service';
import { RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import { ClaudeInsightProvider } from '@adapters/ai/live-provider';
import type { InsightProvider } from '@adapters/ai/types';
import { buildFailureMessage, buildTeamsMessage } from '@adapters/teams/message-builder';
import { MockTeamsSender } from '@adapters/teams/mock-sender';
import { LiveTeamsSender } from '@adapters/teams/live-sender';
import type { TeamsSender } from '@adapters/teams/types';
import { FileSnapshotStore } from '@adapters/storage/file-snapshot-store';
import type { SnapshotStore } from '@adapters/storage/snapshot-store';
import { describe, loadEnv, type PipelineEnv } from './lib/env';
import { RedactingLogger } from './lib/logger';

export interface PipelineDeps {
  env: PipelineEnv;
  source: ReceivablesSource;
  store: SnapshotStore;
  insightProvider: InsightProvider;
  sender: TeamsSender;
  log: RedactingLogger;
  now: () => Date;
  outDir: string;
  forceResend?: boolean;
}

export interface PipelineResult {
  status: 'sent' | 'dry-run' | 'skipped-duplicate' | 'failed';
  report_date: string;
  reason?: string;
  model?: TrackerModel;
  files: string[];
}

export async function runPipeline(d: PipelineDeps): Promise<PipelineResult> {
  const { env, log } = d;
  const now = d.now();
  const localToday = todayInTz(now, env.REPORT_TIMEZONE);
  const reportDate = env.REPORT_DATE ?? latestSaturday(localToday);
  const channel = env.TARGET_CHANNEL;
  const key = `weekly-outstanding:${reportDate}:${channel}`;
  const files: string[] = [];
  await mkdir(d.outDir, { recursive: true });
  log.log(`[1/13] report_date=${reportDate} channel=${channel} dry_run=${env.DRY_RUN} config=${JSON.stringify(describe(env))}`);

  // 2. idempotency
  const receipt = await d.store.getReceipt(key);
  if (receipt?.ok && !receipt.dry_run && !env.DRY_RUN && !d.forceResend) {
    log.log(`[2/13] receipt exists (sent ${receipt.sent_at}); skipping duplicate send. Set FORCE_RESEND=true to override.`);
    return { status: 'skipped-duplicate', report_date: reportDate, files };
  }
  log.log('[2/13] idempotency check passed');

  const ctx = { trackerBaseUrl: env.TRACKER_BASE_URL, timeZone: env.REPORT_TIMEZONE, sentAt: now.toISOString(), channelLabel: channel, lang: env.REPORT_LANGUAGE };

  const fail = async (reason: string): Promise<PipelineResult> => {
    log.log(`[!] FAILURE: ${reason}`);
    const msg = buildFailureMessage(reportDate, reason, ctx);
    await writeFile(join(d.outDir, 'teams-message.json'), JSON.stringify(msg.card, null, 2));
    files.push('teams-message.json');
    if (!env.DRY_RUN) {
      const r = await d.sender.send(msg, channel);
      log.log(`[13/13] failure message to ${channel}: ok=${r.ok} attempts=${r.attempts} ${r.error ?? ''}`);
    }
    const a = await d.sender.alert(`Weekly Outstanding Report ${reportDate} FAILED: ${reason}`);
    log.log(`[13/13] admin alert ok=${a.ok}`);
    await d.store.saveReceipt({ idempotency_key: key + ':failure', report_date: reportDate, channel, ok: false, attempts: 1, sent_at: now.toISOString(), dry_run: env.DRY_RUN, error: reason });
    return { status: 'failed', report_date: reportDate, reason, files };
  };

  // 3. fetch with one retry
  let dataset: ReceivablesDataset;
  try {
    dataset = await withRetry(() => d.source.fetchDataset(reportDate), 2, 3000, (e, n) => log.log(`[3/13] fetch attempt ${n} failed: ${e.message}`));
    log.log(`[3/13] fetched from ${d.source.name}: ${dataset.customers.length} customers, ${dataset.invoices.length} invoices, ${dataset.payments.length} payments, ${dataset.activities.length} activities`);
  } catch (e) {
    return fail(`Data refresh failed: ${(e as Error).message}`);
  }

  // 4. validate
  const validation = validateDataset(dataset);
  const errors = validation.issues.filter((i) => i.severity === 'error');
  if (!validation.ok) return fail(`Data validation failed: ${errors.length} schema/integrity error(s). First: ${errors[0]?.message}`);
  log.log(`[4/13] validation ok (${validation.issues.length} non-blocking data-quality issues)`);

  // 5-7. previous snapshot + calculation
  let prev: Snapshot | null = await d.store.getPreviousSnapshot(reportDate);
  if (!prev && d.source instanceof MockReceivablesSource) {
    const hist = await d.source.history(reportDate, 12);
    for (const h of hist.slice(0, -1)) await d.store.saveSnapshot(h.snapshot);
    prev = hist.length >= 2 ? hist[hist.length - 2].snapshot : null;
    log.log(`[5/13] seeded ${hist.length - 1} historical mock snapshots into store`);
  }
  const model = buildTrackerModel(dataset, { referenceDate: reportDate, previousSnapshot: prev, validationIssues: validation.issues, lang: env.REPORT_LANGUAGE, reflectionChain: env.REFLECTION_CHAIN });
  log.log(`[6/13] calc ok: total=${model.snapshot.totals.total_outstanding} overdue=${model.snapshot.totals.overdue_outstanding} prev=${prev?.snapshot_date ?? 'none'} fx_effect=${model.fx_effect_reporting}`);
  log.log(`[7/13] risk: ${model.customers.filter((c) => c.risk.grade === 'Critical').length} critical, ${model.customers.filter((c) => c.risk.grade === 'High').length} high`);

  // 8-9. insight + verification
  const insight = await generateInsight(model, { provider: d.insightProvider, log: (l) => log.log(l), lang: env.REPORT_LANGUAGE });
  log.log(`[8/13] insight provider=${insight.provider} model=${insight.model ?? '-'} fallback=${insight.fallback_used}`);
  log.log(`[9/13] verification ok=${insight.verification.ok} numbers_checked=${insight.verification.checked_numbers} unverified=${insight.verification.unverified_numbers.length} notes=${insight.verification.notes.join(' | ') || '-'}`);

  // 10. message
  const message = buildTeamsMessage(model, insight, ctx);
  log.log(`[10/13] message built: markdown_chars=${message.markdown_length} card_blocks=${message.card.body.length}`);

  // 12a. persist artifacts (before send so a send failure still leaves evidence)
  await writeFile(join(d.outDir, 'tracker-model.json'), JSON.stringify(publicModel(model)));
  await writeFile(join(d.outDir, 'insight.json'), JSON.stringify(insight, null, 2));
  await writeFile(join(d.outDir, 'teams-message.json'), JSON.stringify(message.card, null, 2));
  await writeFile(join(d.outDir, 'teams-message.md'), message.markdown);
  await writeFile(join(d.outDir, 'snapshot.json'), JSON.stringify(model.snapshot));
  files.push('tracker-model.json', 'insight.json', 'teams-message.json', 'teams-message.md', 'snapshot.json');
  await d.store.saveSnapshot(model.snapshot);

  // 11. send
  if (env.DRY_RUN) {
    log.log(`[11/13] DRY_RUN: not sending. Preview written to ${d.outDir}`);
    await d.store.saveReceipt({ idempotency_key: key, report_date: reportDate, channel, ok: true, attempts: 0, sent_at: now.toISOString(), dry_run: true });
    log.log('[12/13] snapshot + dry-run receipt saved');
    return { status: 'dry-run', report_date: reportDate, model, files };
  }
  const result = await d.sender.send(message, channel);
  await d.store.saveReceipt({ idempotency_key: key, report_date: reportDate, channel, ok: result.ok, status: result.status, attempts: result.attempts, sent_at: result.sent_at, dry_run: false, error: result.error });
  if (!result.ok) {
    const a = await d.sender.alert(`Weekly Outstanding Report ${reportDate}: Teams send to ${channel} failed after ${result.attempts} attempt(s): ${result.error}`);
    log.log(`[11/13] send FAILED (${result.error}); admin alert ok=${a.ok}`);
    return { status: 'failed', report_date: reportDate, reason: `Teams send failed: ${result.error}`, model, files };
  }
  log.log(`[11/13] sent to ${channel}: status=${result.status} attempts=${result.attempts}`);
  log.log('[12/13] snapshot + receipt saved');
  return { status: 'sent', report_date: reportDate, model, files };
}

/** Frontend-safe model: strips invoice-level activity notes and payment references (keep aggregates + amounts). */
export function publicModel(m: TrackerModel): TrackerModel {
  return {
    ...m,
    invoices: m.invoices.map((i) => ({ ...i, activities: i.activities.map((a) => ({ ...a, note: a.note ? '[redacted in published data]' : '' })), payments: i.payments.map((p) => ({ ...p, payment_reference: null })) })),
  };
}

export async function withRetry<T>(fn: () => Promise<T>, attempts: number, delayMs: number, onError: (e: Error, attempt: number) => void): Promise<T> {
  let last: Error = new Error('no attempts');
  for (let n = 1; n <= attempts; n++) {
    try {
      return await fn();
    } catch (e) {
      last = e as Error;
      onError(last, n);
      if (n < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

export function todayInTz(now: Date, tz: string): string {
  const off = tzOffsetMinutes(now, tz);
  return new Date(now.getTime() + off * 60_000).toISOString().slice(0, 10);
}

// ---------- wiring ----------
export function buildDeps(env: PipelineEnv, log: RedactingLogger, now: () => Date = () => new Date()): PipelineDeps {
  log.protect(env.secrets.TEAMS_WEBHOOK_URL, env.secrets.TEAMS_TEST_WEBHOOK_URL, env.secrets.TEAMS_ADMIN_WEBHOOK_URL, env.secrets.AI_API_KEY, env.secrets.ELLIS_MCP_AUTH, env.secrets.ELLIS_MCP_ENDPOINT);
  const refDate = env.REPORT_DATE ?? latestSaturday(todayInTz(now(), env.REPORT_TIMEZONE));
  const source: ReceivablesSource =
    env.DATA_SOURCE === 'mock'
      ? new MockReceivablesSource(20260905, env.REPORTING_CURRENCY)
      : new EllisMcpReceivablesSource(new HttpMcpClient(env.secrets.ELLIS_MCP_ENDPOINT!, env.secrets.ELLIS_MCP_AUTH), {
          reportingCurrency: env.REPORTING_CURRENCY,
          // FX for live mode: until a rates feed is wired (Required item), the illustrative table is used and flagged in completeness notes.
          fx: { ...mockFxTable(refDate, refDate, env.REPORTING_CURRENCY), rates: mockFxTable(refDate, refDate, env.REPORTING_CURRENCY).rates.map((r) => ({ ...r, source: 'ILLUSTRATIVE - replace with treasury/ECB feed' })) },
        });
  const insightProvider: InsightProvider = env.AI_PROVIDER === 'claude' ? new ClaudeInsightProvider({ apiKey: env.secrets.AI_API_KEY!, lang: env.REPORT_LANGUAGE }) : new RuleBasedInsightProvider(env.REPORT_LANGUAGE);
  const sender: TeamsSender =
    env.TEAMS_SENDER === 'live'
      ? new LiveTeamsSender({ leadersWebhookUrl: env.secrets.TEAMS_WEBHOOK_URL, testWebhookUrl: env.secrets.TEAMS_TEST_WEBHOOK_URL, adminWebhookUrl: env.secrets.TEAMS_ADMIN_WEBHOOK_URL, maxAttempts: 3, baseDelayMs: 2000 }, (l) => log.log(l))
      : new MockTeamsSender((l) => log.log(l));
  return { env, source, store: new FileSnapshotStore(env.DATA_STORAGE_CONFIG.dir), insightProvider, sender, log, now, outDir: 'automation/out', forceResend: /^true$/i.test(process.env.FORCE_RESEND ?? '') };
}

const isMain = process.argv[1] && /weekly-report\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const log = new RedactingLogger();
  try {
    const env = loadEnv();
    const deps = buildDeps(env, log);
    const result = await runPipeline(deps);
    log.log(`RESULT ${result.status} report_date=${result.report_date} ${result.reason ?? ''}`);
    if (/^true$/i.test(process.env.PUBLISH_DATA ?? '') && result.model) {
      await mkdir('public/data', { recursive: true });
      await copyFile(join(deps.outDir, 'tracker-model.json'), 'public/data/tracker-model.json');
      await copyFile(join(deps.outDir, 'insight.json'), 'public/data/insight.json');
      log.log('published public/data/tracker-model.json and insight.json (aggregated, no PII)');
    }
    process.exitCode = result.status === 'failed' ? 1 : 0;
  } catch (e) {
    log.log(`FATAL ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

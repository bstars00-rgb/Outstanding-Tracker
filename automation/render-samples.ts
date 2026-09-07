/**
 * Renders committed sample artefacts from mock data in both report languages:
 *   samples/adaptive-card.sample.json (ko), samples/adaptive-card.sample.en.json,
 *   samples/teams-message.sample.md (ko), samples/teams-message.sample.en.md,
 *   samples/insight.sample.json (ko), samples/insight.sample.en.json,
 *   samples/insight-input.sample.json, samples/tracker-model.sample.json, samples/mock-dataset.sample.json
 * Usage: npm run report:sample [-- 2026-09-05]   (REPORTING_CURRENCY env overrides the JPY default)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildTrackerModel } from '@core/calc';
import type { Lang } from '@core/i18n';
import { validateDataset } from '@core/validate';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { DEFAULT_REPORTING_CURRENCY } from '@adapters/ellis/mock-data';
import { generateInsight, buildInsightInput } from '@adapters/ai/insight-service';
import { RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import { buildTeamsMessage, buildFailureMessage } from '@adapters/teams/message-builder';

const ref = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : '2026-09-05';
const ccy = (process.env.REPORTING_CURRENCY ?? DEFAULT_REPORTING_CURRENCY).toUpperCase();
const src = new MockReceivablesSource(20260905, ccy);
const ds = await src.fetchDataset(ref);
const prev = await src.previousSnapshot(ref);
const v = validateDataset(ds);
const ctxBase = { trackerBaseUrl: 'https://bstars00-rgb.github.io/Outstanding-Tracker/', timeZone: 'Asia/Ho_Chi_Minh', sentAt: `${ref}T02:00:00.000Z`, channelLabel: 'leaders' as const };
await mkdir('samples', { recursive: true });

for (const lang of ['ko', 'en'] as Lang[]) {
  const model = buildTrackerModel(ds, { referenceDate: ref, previousSnapshot: prev, validationIssues: v.issues, lang });
  const insight = await generateInsight(model, { provider: new RuleBasedInsightProvider(lang), lang });
  const msg = buildTeamsMessage(model, insight, { ...ctxBase, lang });
  const suffix = lang === 'ko' ? '' : '.en';
  await writeFile(`samples/adaptive-card.sample${suffix}.json`, JSON.stringify(msg.card, null, 2));
  await writeFile(`samples/teams-message.sample${suffix}.md`, msg.markdown + '\n');
  await writeFile(`samples/insight.sample${suffix}.json`, JSON.stringify(insight, null, 2));
  if (lang === 'ko') {
    const failure = buildFailureMessage(ref, 'Ellis MCP get_hotel_bookings timed out after 2 attempts (Japan, offset 1500)', { ...ctxBase, lang });
    await writeFile('samples/adaptive-card.failure.sample.json', JSON.stringify(failure.card, null, 2));
    await writeFile('samples/insight-input.sample.json', JSON.stringify(buildInsightInput(model), null, 2));
    await writeFile('samples/tracker-model.sample.json', JSON.stringify({ ...model, invoices: model.invoices.slice(0, 20) }, null, 2));
    await writeFile('samples/mock-dataset.sample.json', JSON.stringify({ ...ds, note: 'Full mock dataset (fictional).' }, null, 1));
  }
  console.log(`[${lang}] samples rendered for ${ref} in ${ccy}: markdown ${msg.markdown_length} chars, card blocks ${msg.card.body.length}, customers ${model.customers.length}, invoices ${model.invoices.length}, verification ok=${insight.verification.ok}`);
}

/**
 * Renders committed sample artefacts from mock data:
 *   samples/adaptive-card.sample.json, samples/teams-message.sample.md, samples/insight.sample.json,
 *   samples/insight-input.sample.json, samples/tracker-model.sample.json
 * Usage: npm run report:sample [-- 2026-09-05]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildTrackerModel } from '@core/calc';
import { validateDataset } from '@core/validate';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { generateInsight, buildInsightInput } from '@adapters/ai/insight-service';
import { RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import { buildTeamsMessage, buildFailureMessage } from '@adapters/teams/message-builder';

const ref = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : '2026-09-05';
const src = new MockReceivablesSource();
const ds = await src.fetchDataset(ref);
const prev = await src.previousSnapshot(ref);
const v = validateDataset(ds);
const model = buildTrackerModel(ds, { referenceDate: ref, previousSnapshot: prev, validationIssues: v.issues });
const insight = await generateInsight(model, { provider: new RuleBasedInsightProvider() });
const ctx = { trackerBaseUrl: 'https://<org>.github.io/outstanding-tracker/', timeZone: 'Asia/Ho_Chi_Minh', sentAt: `${ref}T02:00:00.000Z`, channelLabel: 'leaders' as const };
const msg = buildTeamsMessage(model, insight, ctx);
const failure = buildFailureMessage(ref, 'Ellis MCP get_hotel_bookings timed out after 2 attempts (Japan, offset 1500)', ctx);
await mkdir('samples', { recursive: true });
await writeFile('samples/adaptive-card.sample.json', JSON.stringify(msg.card, null, 2));
await writeFile('samples/adaptive-card.failure.sample.json', JSON.stringify(failure.card, null, 2));
await writeFile('samples/teams-message.sample.md', msg.markdown + '\n');
await writeFile('samples/insight.sample.json', JSON.stringify(insight, null, 2));
await writeFile('samples/insight-input.sample.json', JSON.stringify(buildInsightInput(model), null, 2));
await writeFile('samples/tracker-model.sample.json', JSON.stringify({ ...model, invoices: model.invoices.slice(0, 20) }, null, 2));
await writeFile('samples/mock-dataset.sample.json', JSON.stringify({ ...ds, invoices: ds.invoices, note: 'Full mock dataset (fictional).' }, null, 1));
console.log(`samples rendered for ${ref}: markdown ${msg.markdown_length} chars, card blocks ${msg.card.body.length}, customers ${model.customers.length}, invoices ${model.invoices.length}, verification ok=${insight.verification.ok}`);

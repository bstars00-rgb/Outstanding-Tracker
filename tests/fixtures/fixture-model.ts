import { buildTrackerModel } from '@core/calc';
import { validateDataset } from '@core/validate';
import type { Lang } from '@core/i18n';
import type { ISODate, ReceivablesDataset, TrackerModel } from '@core/types';
import { FixtureReceivablesSource } from './fixture-source';
import { generateInsight } from '@adapters/ai/insight-service';
import { RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import type { InsightResult } from '@adapters/ai/types';

export interface FixtureBuild {
  model: TrackerModel;
  insight: InsightResult;
  /** Weekly snapshot dates (oldest first) known to the fixture source for this reference date. */
  dates: ISODate[];
}

let sharedSource: FixtureReceivablesSource | null = null;
export function fixtureSource(): FixtureReceivablesSource {
  if (!sharedSource) sharedSource = new FixtureReceivablesSource();
  return sharedSource;
}

/**
 * Build the full tracker model + insight for a reference date from the test fixture source, exactly the
 * way the UI hook does (shared with unit tests). `empty=true` produces a dataset without invoices;
 * `lang` selects the language of the engine-generated wording (labels, evidence, actions, insight).
 */
export async function buildFixtureModel(referenceDate: ISODate, opts: { empty?: boolean; source?: FixtureReceivablesSource; lang?: Lang } = {}): Promise<FixtureBuild> {
  const source = opts.source ?? fixtureSource();
  const lang: Lang = opts.lang ?? 'en';
  const history = await source.history(referenceDate, 12);
  const dates = history.map((h) => h.date);
  const previousSnapshot = history.length >= 2 ? history[history.length - 2].snapshot : null;
  let dataset: ReceivablesDataset = await source.fetchDataset(referenceDate);
  if (opts.empty) {
    dataset = { ...dataset, customers: [], invoices: [], payments: [], activities: [], bookings: [] };
  }
  const validation = validateDataset(dataset);
  const model = buildTrackerModel(dataset, {
    referenceDate,
    previousSnapshot: opts.empty ? null : previousSnapshot,
    validationIssues: validation.issues,
    lang,
  });
  const insight = await generateInsight(model, { provider: new RuleBasedInsightProvider(lang), lang });
  return { model, insight, dates };
}

import { buildTrackerModel } from '@core/calc';
import { validateDataset } from '@core/validate';
import type { ISODate, ReceivablesDataset, TrackerModel } from '@core/types';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { generateInsight } from '@adapters/ai/insight-service';
import { RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import type { InsightResult } from '@adapters/ai/types';

export interface MockBuild {
  model: TrackerModel;
  insight: InsightResult;
  /** Weekly snapshot dates (oldest first) known to the mock source for this reference date. */
  dates: ISODate[];
}

let sharedSource: MockReceivablesSource | null = null;
export function mockSource(): MockReceivablesSource {
  if (!sharedSource) sharedSource = new MockReceivablesSource();
  return sharedSource;
}

/**
 * Build the full tracker model + insight for a reference date from the mock source, exactly the
 * way the UI hook does (shared with unit tests). `empty=true` produces a dataset without invoices.
 */
export async function buildMockModel(referenceDate: ISODate, opts: { empty?: boolean; source?: MockReceivablesSource } = {}): Promise<MockBuild> {
  const source = opts.source ?? mockSource();
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
  });
  const insight = await generateInsight(model, { provider: new RuleBasedInsightProvider() });
  return { model, insight, dates };
}

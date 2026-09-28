import { buildSnapshotHistory, type HistoryPoint } from '@core/history';
import type { ISODate, ReceivablesDataset, Snapshot } from '@core/types';
import { DEFAULT_REPORTING_CURRENCY, generateFixtureDataset, fixtureFxTable, weeklyDates } from './fixture-data';
import type { ReceivablesSource } from '@adapters/ellis/types';

/**
 * TEST FIXTURE source: deterministic dataset anchored on the reference date. Also exposes a 12-week
 * snapshot history so the UI and the pipeline can compare against "last week" without storage.
 */
export class FixtureReceivablesSource implements ReceivablesSource {
  readonly name = 'test-fixture';
  readonly kind = 'file' as const;
  private cache = new Map<string, ReceivablesDataset>();

  constructor(
    private readonly seed = 20260905,
    private readonly reportingCurrency: string = DEFAULT_REPORTING_CURRENCY,
  ) {}

  async fetchDataset(referenceDate: ISODate): Promise<ReceivablesDataset> {
    let ds = this.cache.get(referenceDate);
    if (!ds) {
      ds = generateFixtureDataset(referenceDate, this.seed, this.reportingCurrency);
      this.cache.set(referenceDate, ds);
    }
    return ds;
  }

  async healthCheck() {
    return { ok: true, detail: 'test fixture always available' };
  }

  /** Snapshots for the 12 Saturdays ending at referenceDate (oldest first). */
  async history(referenceDate: ISODate, weeks = 12): Promise<HistoryPoint[]> {
    const full = await this.fetchDataset(referenceDate);
    return buildSnapshotHistory(full, weeklyDates(referenceDate, weeks), (d) => fixtureFxTable(d, referenceDate, full.reporting_currency));
  }

  /** Previous-week snapshot (the one before the reference date). */
  async previousSnapshot(referenceDate: ISODate): Promise<Snapshot | null> {
    const h = await this.history(referenceDate, 12);
    return h.length >= 2 ? h[h.length - 2].snapshot : null;
  }
}

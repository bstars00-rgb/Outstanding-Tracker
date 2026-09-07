import type { ISODate, Snapshot } from '@core/types';

/** Persistence boundary for weekly snapshots and send receipts. */
export interface SnapshotStore {
  getSnapshot(date: ISODate): Promise<Snapshot | null>;
  /** Latest snapshot strictly before `date`. */
  getPreviousSnapshot(date: ISODate): Promise<Snapshot | null>;
  saveSnapshot(s: Snapshot): Promise<void>;
  listSnapshotDates(): Promise<ISODate[]>;
  getReceipt(key: string): Promise<SendReceipt | null>;
  saveReceipt(r: SendReceipt): Promise<void>;
}

export interface SendReceipt {
  idempotency_key: string;
  report_date: ISODate;
  channel: string;
  ok: boolean;
  status?: number;
  attempts: number;
  sent_at: string;
  dry_run: boolean;
  error?: string;
}

export class InMemorySnapshotStore implements SnapshotStore {
  private snaps = new Map<ISODate, Snapshot>();
  private receipts = new Map<string, SendReceipt>();
  constructor(initial: Snapshot[] = []) {
    for (const s of initial) this.snaps.set(s.snapshot_date, s);
  }
  async getSnapshot(date: ISODate) {
    return this.snaps.get(date) ?? null;
  }
  async getPreviousSnapshot(date: ISODate) {
    const prev = [...this.snaps.keys()].filter((d) => d < date).sort().pop();
    return prev ? (this.snaps.get(prev) ?? null) : null;
  }
  async saveSnapshot(s: Snapshot) {
    this.snaps.set(s.snapshot_date, s);
  }
  async listSnapshotDates() {
    return [...this.snaps.keys()].sort();
  }
  async getReceipt(key: string) {
    return this.receipts.get(key) ?? null;
  }
  async saveReceipt(r: SendReceipt) {
    this.receipts.set(r.idempotency_key, r);
  }
}

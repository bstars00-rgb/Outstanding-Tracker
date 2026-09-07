import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ISODate, Snapshot } from '@core/types';
import type { SendReceipt, SnapshotStore } from './snapshot-store';

/**
 * File-based store (default for GitHub Actions). Snapshots live in <dir>/snapshots/<date>.json and
 * receipts in <dir>/receipts/<key>.json. The directory is persisted between runs by committing it
 * to a data branch or restoring it with actions/cache (see ARCHITECTURE.md).
 * Snapshots contain aggregated figures only (no PII, no invoice text).
 */
export class FileSnapshotStore implements SnapshotStore {
  constructor(private readonly dir: string) {}

  private async ensure(sub: string) {
    const p = join(this.dir, sub);
    await mkdir(p, { recursive: true });
    return p;
  }

  async getSnapshot(date: ISODate) {
    try {
      return JSON.parse(await readFile(join(this.dir, 'snapshots', `${date}.json`), 'utf8')) as Snapshot;
    } catch {
      return null;
    }
  }

  async getPreviousSnapshot(date: ISODate) {
    const dates = (await this.listSnapshotDates()).filter((d) => d < date);
    const prev = dates.pop();
    return prev ? this.getSnapshot(prev) : null;
  }

  async saveSnapshot(s: Snapshot) {
    const p = await this.ensure('snapshots');
    await writeFile(join(p, `${s.snapshot_date}.json`), JSON.stringify(s), 'utf8');
  }

  async listSnapshotDates() {
    try {
      const files = await readdir(join(this.dir, 'snapshots'));
      return files.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
    } catch {
      return [];
    }
  }

  async getReceipt(key: string) {
    try {
      return JSON.parse(await readFile(join(this.dir, 'receipts', `${safe(key)}.json`), 'utf8')) as SendReceipt;
    } catch {
      return null;
    }
  }

  async saveReceipt(r: SendReceipt) {
    const p = await this.ensure('receipts');
    await writeFile(join(p, `${safe(r.idempotency_key)}.json`), JSON.stringify(r, null, 2), 'utf8');
  }
}

const safe = (k: string) => k.replace(/[^a-zA-Z0-9_.-]+/g, '_');

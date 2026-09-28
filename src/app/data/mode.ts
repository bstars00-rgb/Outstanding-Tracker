import type { TrackerModel } from '@core/types';
import type { InsightResult } from '@adapters/ai/types';
import { gateEnabled } from '@app/gate/config';
import { b64decode } from '@app/gate/hash';
import { BUNDLE_FILE, DataLockedError, decryptBundle, isEncryptedBundle, readStoredDataKey, type EncryptedBundle } from '@app/gate/data-crypto';

export const LIVE_NOT_PUBLISHED_MESSAGE =
  'No data published yet / 게시된 데이터가 없습니다. Run the weekly pipeline (DATA_SOURCE=file) and publish its output (npm run publish:data)';

/** Base URL where the automation pipeline publishes its output (bundle.enc.json, or plaintext JSON for local preview). */
export function liveDataBaseUrl(): string {
  const explicit = import.meta.env.VITE_LIVE_DATA_URL as string | undefined;
  const base = explicit && explicit.length > 0 ? explicit : `${import.meta.env.BASE_URL ?? '/'}data/`;
  return base.endsWith('/') ? base : `${base}/`;
}

export interface LiveData {
  model: TrackerModel;
  insight: InsightResult;
}

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    throw new Error(`${LIVE_NOT_PUBLISHED_MESSAGE} (network error fetching ${url}: ${(e as Error).message})`);
  }
  if (!res.ok) throw new Error(`${LIVE_NOT_PUBLISHED_MESSAGE} (HTTP ${res.status} for ${url})`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${LIVE_NOT_PUBLISHED_MESSAGE} (invalid JSON at ${url})`);
  }
}

/** The encrypted bundle if published (null on 404 / network error). */
export async function fetchEncryptedBundle(): Promise<EncryptedBundle | null> {
  try {
    const res = await fetch(`${liveDataBaseUrl()}${BUNDLE_FILE}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = (await res.json()) as unknown;
    return isEncryptedBundle(v) ? v : null;
  } catch {
    return null;
  }
}

async function fetchPlain(): Promise<LiveData> {
  const base = liveDataBaseUrl();
  const [model, insight] = await Promise.all([fetchJson<TrackerModel>(`${base}tracker-model.json`), fetchJson<InsightResult>(`${base}insight.json`)]);
  return { model, insight };
}

async function fetchEncrypted(bundle: EncryptedBundle): Promise<LiveData> {
  const stored = readStoredDataKey();
  if (!stored || stored.salt !== bundle.salt) throw new DataLockedError();
  const payload = await decryptBundle<LiveData>(b64decode(stored.key), bundle);
  if (!payload || !payload.model || !payload.insight) throw new Error('Encrypted bundle has an unexpected shape');
  return payload;
}

/**
 * Fetch the published model + insight. With the password gate on, the encrypted bundle is the primary source
 * (plaintext is never deployed); locally (gate off) plaintext JSON from the pipeline is preferred.
 * Throws DataLockedError when the bundle exists but no matching key is in this browser.
 */
export async function fetchLiveData(): Promise<LiveData> {
  if (gateEnabled()) {
    const bundle = await fetchEncryptedBundle();
    if (bundle) return fetchEncrypted(bundle);
    return fetchPlain();
  }
  try {
    return await fetchPlain();
  } catch (plainError) {
    const bundle = await fetchEncryptedBundle();
    if (bundle) {
      const stored = readStoredDataKey();
      if (!stored) throw new Error('Only the encrypted bundle is available and the gate is disabled in this build: set VITE_GATE_HASH or publish plaintext JSON for local preview.');
      return fetchEncrypted(bundle);
    }
    throw plainError;
  }
}

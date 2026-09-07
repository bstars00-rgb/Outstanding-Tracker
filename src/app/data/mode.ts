import type { TrackerModel } from '@core/types';
import type { InsightResult } from '@adapters/ai/types';

export type DataMode = 'mock' | 'live';

export const MODE_STORAGE_KEY = 'ot.mode';

export const LIVE_NOT_PUBLISHED_MESSAGE =
  'Live data not published yet. Run the weekly pipeline with PUBLISH_DATA=true or switch to mock mode';

function isMode(v: unknown): v is DataMode {
  return v === 'mock' || v === 'live';
}

/** Mode configured at build time (VITE_DATA_MODE), defaulting to mock. */
export function envMode(): DataMode {
  const v = (import.meta.env.VITE_DATA_MODE as string | undefined)?.toLowerCase();
  return isMode(v) ? v : 'mock';
}

export function readStoredMode(): DataMode | null {
  try {
    const v = window.localStorage.getItem(MODE_STORAGE_KEY);
    return isMode(v) ? v : null;
  } catch {
    return null;
  }
}

export function persistMode(mode: DataMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* storage unavailable: ignore */
  }
}

/**
 * Resolution order: URL query (?mode=live|mock, persisted when present) -> localStorage -> build env.
 */
export function resolveInitialMode(queryMode: string | null): DataMode {
  if (isMode(queryMode)) {
    persistMode(queryMode);
    return queryMode;
  }
  return readStoredMode() ?? envMode();
}

/** Base URL where the automation pipeline publishes tracker-model.json and insight.json. */
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

/** Fetch the published model + insight. Throws with a clear message when not available. */
export async function fetchLiveData(): Promise<LiveData> {
  const base = liveDataBaseUrl();
  const [model, insight] = await Promise.all([fetchJson<TrackerModel>(`${base}tracker-model.json`), fetchJson<InsightResult>(`${base}insight.json`)]);
  if (!model || !Array.isArray(model.kpis) || !Array.isArray(model.invoices)) {
    throw new Error(`${LIVE_NOT_PUBLISHED_MESSAGE} (tracker-model.json has an unexpected shape)`);
  }
  return { model, insight };
}

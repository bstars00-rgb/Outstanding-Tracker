import type { TrackerModel } from '@core/types';
import type { InsightResult } from '@adapters/ai/types';

export const LIVE_NOT_PUBLISHED_MESSAGE =
  'No data published yet / 게시된 데이터가 없습니다. Run the weekly pipeline (DATA_SOURCE=file, PUBLISH_DATA=true) and deploy its output';

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
  return { model, insight };
}

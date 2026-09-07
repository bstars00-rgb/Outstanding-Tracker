import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { latestSaturday, todayISO } from '@core/dates';
import type { Lang } from '@core/i18n';
import type { ISODate, TrackerModel } from '@core/types';
import type { InsightResult } from '@adapters/ai/types';
import { translate } from '@app/i18n/strings';
import { useI18n } from '@app/i18n/useI18n';
import { buildMockModel } from './mock-model';
import { fetchLiveData, persistMode, resolveInitialMode, type DataMode } from './mode';

export type TrackerStatus = 'loading' | 'ready' | 'error' | 'partial';

export interface TrackerData {
  status: TrackerStatus;
  model: TrackerModel | null;
  insight: InsightResult | null;
  error: string | null;
  mode: DataMode;
  setMode: (mode: DataMode) => void;
  referenceDate: ISODate;
  setReferenceDate: (date: ISODate) => void;
  availableDates: ISODate[];
  refresh: () => void;
  /** Completeness/data-quality notes shown in the partial banner. */
  partialNotes: string[];
}

/** Artificial delay so skeleton states are visible (and testable). */
const LOAD_DELAY_MS = 150;
const SLOW_DELAY_MS = 2500;

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

const COMPLETENESS_KEYS = ['customers', 'invoices', 'payments', 'activities', 'fx'] as const;

export function partialNotesFor(model: TrackerModel, lang: Lang = 'en'): string[] {
  const notes: string[] = [];
  const c = model.completeness;
  COMPLETENESS_KEYS.forEach((k) => {
    if (c[k] !== 'full') notes.push(`${translate(lang, `entity.${k}`)}: ${translate(lang, `level.${c[k]}`)}`);
  });
  const errors = model.data_quality.filter((d) => d.severity === 'error');
  if (errors.length) notes.push(translate(lang, 'partial.dqErrors', { n: errors.length, codes: [...new Set(errors.map((e) => e.code))].join(', ') }));
  notes.push(...c.notes);
  return notes;
}

export function isPartial(model: TrackerModel): boolean {
  const c = model.completeness;
  const partial = COMPLETENESS_KEYS.some((k) => c[k] !== 'full');
  return partial || model.data_quality.some((d) => d.severity === 'error');
}

interface LoadState {
  status: TrackerStatus;
  model: TrackerModel | null;
  insight: InsightResult | null;
  error: string | null;
}

export function useTrackerData(): TrackerData {
  const [searchParams, setSearchParams] = useSearchParams();
  const simulate = searchParams.get('simulate');
  const queryMode = searchParams.get('mode');
  const { lang } = useI18n();

  const [mode, setModeState] = useState<DataMode>(() => resolveInitialMode(queryMode));
  const [referenceDate, setReferenceDateState] = useState<ISODate>(() => latestSaturday(todayISO()));
  const [availableDates, setAvailableDates] = useState<ISODate[]>([]);
  const [state, setState] = useState<LoadState>({ status: 'loading', model: null, insight: null, error: null });
  const [tick, setTick] = useState(0);
  const datesLoaded = useRef(false);

  // A later ?mode= in the URL (e.g. user pasted a link) wins over the persisted choice.
  useEffect(() => {
    if (queryMode === 'mock' || queryMode === 'live') {
      persistMode(queryMode);
      setModeState(queryMode);
    }
  }, [queryMode]);

  // In mock mode the model is rebuilt in the UI language; live JSON is whatever the pipeline published.
  const buildLang: Lang | null = mode === 'mock' ? lang : null;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', model: null, insight: null, error: null });
    (async () => {
      await delay(simulate === 'slow' ? SLOW_DELAY_MS : LOAD_DELAY_MS);
      if (simulate === 'error') throw new Error('Simulated data source failure (?simulate=error). The data source did not respond.');
      if (mode === 'mock') {
        const built = await buildMockModel(referenceDate, { empty: simulate === 'empty', lang: buildLang ?? 'en' });
        if (cancelled) return;
        if (!datesLoaded.current) {
          datesLoaded.current = true;
          setAvailableDates(built.dates);
        }
        setState({ status: isPartial(built.model) ? 'partial' : 'ready', model: built.model, insight: built.insight, error: null });
      } else {
        const live = await fetchLiveData();
        if (cancelled) return;
        const model = simulate === 'empty' ? { ...live.model, invoices: [], customers: [], actions: [] } : live.model;
        setAvailableDates([model.reference_date]);
        setState({ status: isPartial(model) ? 'partial' : 'ready', model, insight: live.insight, error: null });
      }
    })().catch((e: unknown) => {
      if (cancelled) return;
      setState({ status: 'error', model: null, insight: null, error: (e as Error).message ?? String(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [mode, referenceDate, tick, simulate, buildLang]);

  const setMode = useCallback(
    (m: DataMode) => {
      persistMode(m);
      setModeState(m);
      if (searchParams.has('mode')) {
        const next = new URLSearchParams(searchParams);
        next.delete('mode');
        setSearchParams(next, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const setReferenceDate = useCallback((d: ISODate) => setReferenceDateState(d), []);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const partialNotes = useMemo(() => (state.model ? partialNotesFor(state.model, lang) : []), [state.model, lang]);

  return {
    status: state.status,
    model: state.model,
    insight: state.insight,
    error: state.error,
    mode,
    setMode,
    referenceDate: mode === 'live' && state.model ? state.model.reference_date : referenceDate,
    setReferenceDate,
    availableDates,
    refresh,
    partialNotes,
  };
}

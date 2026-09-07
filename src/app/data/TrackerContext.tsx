import { createContext, useContext, type ReactNode } from 'react';
import type { TrackerModel } from '@core/types';
import type { InsightResult } from '@adapters/ai/types';
import { useTrackerData, type TrackerData } from './useTrackerData';

export const TrackerContext = createContext<TrackerData | null>(null);

export function TrackerProvider({ children }: { children: ReactNode }) {
  const data = useTrackerData();
  return <TrackerContext.Provider value={data}>{children}</TrackerContext.Provider>;
}

export function useTracker(): TrackerData {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error('useTracker must be used inside TrackerProvider');
  return ctx;
}

export interface ReadyTracker {
  model: TrackerModel;
  insight: InsightResult;
  data: TrackerData;
}

/** For pages rendered behind the DataGate: model and insight are guaranteed present. */
export function useReadyTracker(): ReadyTracker {
  const data = useTracker();
  if (!data.model || !data.insight) throw new Error('Tracker data not ready; page must be rendered inside DataGate');
  return { model: data.model, insight: data.insight, data };
}

/** Test helper: a fully "ready" context value around a prebuilt model/insight. */
export function readyContextValue(model: TrackerModel, insight: InsightResult, overrides: Partial<TrackerData> = {}): TrackerData {
  return {
    status: 'ready',
    model,
    insight,
    error: null,
    mode: 'mock',
    setMode: () => {},
    referenceDate: model.reference_date,
    setReferenceDate: () => {},
    availableDates: [model.reference_date],
    refresh: () => {},
    partialNotes: [],
    ...overrides,
  };
}

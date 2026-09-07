import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTracker } from '@app/data/TrackerContext';
import { Banner } from './Banner';
import { PageSkeleton } from './Skeleton';

export function ErrorState({ message, onRetry, onSwitchToMock, showSwitch }: { message: string; onRetry: () => void; onSwitchToMock: () => void; showSwitch: boolean }) {
  return (
    <div className="state" data-testid="state-error" role="alert">
      <h2>Data could not be loaded</h2>
      <p>{message}</p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onRetry}>
          Retry
        </button>
        {showSwitch && (
          <button type="button" className="btn" onClick={onSwitchToMock}>
            Switch to mock data
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ referenceDate, onRefresh }: { referenceDate: string; onRefresh: () => void }) {
  return (
    <div className="state" data-testid="state-empty" role="status">
      <h2>No invoices in this dataset</h2>
      <p>
        The data source returned no outstanding invoices for reference date {referenceDate}. Nothing to track — either receivables are fully collected or the export is
        incomplete.
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </div>
  );
}

function skeletonVariant(pathname: string): 'overview' | 'table' | 'board' | 'detail' {
  if (pathname === '/' || pathname === '') return 'overview';
  if (pathname.startsWith('/actions')) return 'board';
  if (/^\/customers\/[^/]+/.test(pathname) || pathname.startsWith('/insights')) return 'detail';
  return 'table';
}

/**
 * Renders loading / error / empty states for every page; children (the page) render only when the
 * model is available. The partial-data banner is shown above the page but does not block it.
 */
export function DataGate({ children }: { children: ReactNode }) {
  const data = useTracker();
  const { pathname } = useLocation();
  if (data.status === 'loading') return <PageSkeleton variant={skeletonVariant(pathname)} />;
  if (data.status === 'error' || !data.model || !data.insight) {
    return <ErrorState message={data.error ?? 'Unknown error'} onRetry={data.refresh} onSwitchToMock={() => data.setMode('mock')} showSwitch={data.mode !== 'mock'} />;
  }
  if (data.model.invoices.length === 0) return <EmptyState referenceDate={data.model.reference_date} onRefresh={data.refresh} />;
  return (
    <>
      {data.status === 'partial' && (
        <Banner kind="warning" title="Partial data." testId="banner-partial">
          Some inputs are incomplete; figures are computed on the available data.
          {data.partialNotes.length > 0 && (
            <details className="banner-details">
              <summary>Show {data.partialNotes.length} note{data.partialNotes.length > 1 ? 's' : ''}</summary>
              <ul>
                {data.partialNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </Banner>
      )}
      {children}
    </>
  );
}

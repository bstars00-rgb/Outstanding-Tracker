import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTracker } from '@app/data/TrackerContext';
import { useI18n } from '@app/i18n/useI18n';
import { Banner } from './Banner';
import { PageSkeleton } from './Skeleton';

export function ErrorState({ message, onRetry, onSwitchToMock, showSwitch }: { message: string; onRetry: () => void; onSwitchToMock: () => void; showSwitch: boolean }) {
  const { t } = useI18n();
  return (
    <div className="state" data-testid="state-error" role="alert">
      <h2>{t('state.error.title')}</h2>
      <p>{message}</p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onRetry}>
          {t('state.retry')}
        </button>
        {showSwitch && (
          <button type="button" className="btn" onClick={onSwitchToMock}>
            {t('state.switchMock')}
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ referenceDate, onRefresh }: { referenceDate: string; onRefresh: () => void }) {
  const { t } = useI18n();
  return (
    <div className="state" data-testid="state-empty" role="status">
      <h2>{t('state.empty.title')}</h2>
      <p>{t('state.empty.body', { date: referenceDate })}</p>
      <div className="actions">
        <button type="button" className="btn" onClick={onRefresh}>
          {t('state.refresh')}
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
  const { t } = useI18n();
  const { pathname } = useLocation();
  if (data.status === 'loading') return <PageSkeleton variant={skeletonVariant(pathname)} />;
  if (data.status === 'error' || !data.model || !data.insight) {
    return <ErrorState message={data.error ?? t('state.unknownError')} onRetry={data.refresh} onSwitchToMock={() => data.setMode('mock')} showSwitch={data.mode !== 'mock'} />;
  }
  if (data.model.invoices.length === 0) return <EmptyState referenceDate={data.model.reference_date} onRefresh={data.refresh} />;
  return (
    <>
      {data.status === 'partial' && (
        <Banner kind="warning" title={t('banner.partial.title')} testId="banner-partial">
          {t('banner.partial.body')}
          {data.partialNotes.length > 0 && (
            <details className="banner-details">
              <summary>{t('banner.partial.showNotes', { n: data.partialNotes.length })}</summary>
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

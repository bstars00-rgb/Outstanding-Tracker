import type { CSSProperties } from 'react';
import { useI18n } from '@app/i18n/useI18n';

export function Skeleton({ width = '100%', height = 14, style, className }: { width?: number | string; height?: number | string; style?: CSSProperties; className?: string }) {
  return <div className={`skeleton ${className ?? ''}`} style={{ width, height, ...style }} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <Skeleton width="55%" height={12} />
      <Skeleton width="70%" height={24} />
      {Array.from({ length: lines - 2 }).map((_, i) => (
        <Skeleton key={i} width={`${90 - i * 15}%`} height={12} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <Skeleton width="30%" height={16} />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: 10 }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Full-page skeleton chosen by route. */
export function PageSkeleton({ variant }: { variant: 'overview' | 'table' | 'board' | 'detail' }) {
  const { t } = useI18n();
  return (
    <div data-testid="state-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t('state.loading')}</span>
      <div className="page-header">
        <div style={{ display: 'grid', gap: 8 }}>
          <Skeleton width={260} height={24} />
          <Skeleton width={360} height={12} />
        </div>
      </div>
      {variant === 'overview' && (
        <>
          <div className="kpi-grid section">
            {Array.from({ length: 10 }).map((_, i) => (
              <SkeletonCard key={i} lines={4} />
            ))}
          </div>
          <div className="grid-2">
            <SkeletonTable rows={5} cols={4} />
            <SkeletonTable rows={5} cols={4} />
          </div>
        </>
      )}
      {variant === 'table' && (
        <>
          <div className="card section">
            <Skeleton width="100%" height={32} />
          </div>
          <SkeletonTable rows={10} cols={8} />
        </>
      )}
      {variant === 'board' && (
        <div className="board">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} lines={5} />
          ))}
        </div>
      )}
      {variant === 'detail' && (
        <>
          <div className="grid-3 section">
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
          </div>
          <SkeletonTable rows={6} cols={5} />
        </>
      )}
    </div>
  );
}

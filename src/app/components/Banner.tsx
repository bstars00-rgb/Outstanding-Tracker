import type { ReactNode } from 'react';
import { IconAlert, IconInfo, IconWarning } from './Icons';

export function Banner({ kind, title, children, testId }: { kind: 'info' | 'warning' | 'error'; title?: string; children?: ReactNode; testId?: string }) {
  const Icon = kind === 'info' ? IconInfo : kind === 'warning' ? IconWarning : IconAlert;
  const role = kind === 'error' ? 'alert' : 'status';
  return (
    <div className={`banner ${kind}`} role={role} data-testid={testId}>
      <Icon width={18} height={18} style={{ flex: '0 0 auto', marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        {title && <strong>{title} </strong>}
        {children}
      </div>
    </div>
  );
}

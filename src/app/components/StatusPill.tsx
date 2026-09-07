import type { ReactNode } from 'react';
import { IconAlert, IconCheck, IconInfo, IconMinus, IconWarning } from './Icons';

export type PillTone = 'good' | 'neutral' | 'warning' | 'critical' | 'info';

const ICON: Record<PillTone, (p: { width?: number; height?: number }) => JSX.Element> = {
  good: IconCheck,
  neutral: IconMinus,
  warning: IconWarning,
  critical: IconAlert,
  info: IconInfo,
};

export function StatusPill({ tone, children, title, icon = true, testId }: { tone: PillTone; children: ReactNode; title?: string; icon?: boolean; testId?: string }) {
  const Icon = ICON[tone];
  return (
    <span className={`pill ${tone}`} title={title} data-testid={testId}>
      {icon && <Icon width={12} height={12} />}
      {children}
    </span>
  );
}

export function severityTone(sev: 'low' | 'medium' | 'high' | 'critical'): PillTone {
  return sev === 'critical' ? 'critical' : sev === 'high' ? 'warning' : sev === 'medium' ? 'info' : 'neutral';
}

export function invoiceStatusTone(status: string): PillTone {
  switch (status) {
    case 'PAID':
    case 'CREDITED':
      return 'good';
    case 'DISPUTED':
      return 'critical';
    case 'PARTIALLY_PAID':
      return 'info';
    case 'CANCELLED':
    case 'WRITTEN_OFF':
      return 'neutral';
    default:
      return 'neutral';
  }
}

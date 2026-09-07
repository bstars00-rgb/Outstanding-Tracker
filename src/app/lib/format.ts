import { formatMoney, formatPct } from '@core/money';
import type { KpiValue } from '@core/types';

export const STATUS_LABEL: Record<KpiValue['status'], string> = {
  good: 'Good',
  neutral: 'Neutral',
  warning: 'Warning',
  critical: 'Critical',
};

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtDate(d: string | null | undefined): string {
  return d && d.length > 0 ? d : '—';
}

/** Ratio (0..1) as percent, or dash. */
export function fmtRatio(r: number | null | undefined, digits = 1): string {
  return r === null || r === undefined ? '—' : formatPct(r, { digits });
}

export function kpiValueText(kpi: KpiValue, ccy: string): string {
  switch (kpi.unit) {
    case 'currency':
      return formatMoney(kpi.value, ccy);
    case 'ratio':
      return formatPct(kpi.value);
    case 'count':
      return fmtInt(kpi.value);
  }
}

/** "WoW +USD 1,234.00 (+3.2%)" style change text; null when there is no previous week. */
export function kpiChangeText(kpi: KpiValue, ccy: string): string | null {
  if (kpi.change === null) return null;
  switch (kpi.unit) {
    case 'currency': {
      const pct = kpi.change_pct === null ? '' : ` (${formatPct(kpi.change_pct, { signed: true })})`;
      return `${formatMoney(kpi.change, ccy, { signed: true })}${pct}`;
    }
    case 'ratio': {
      const pp = kpi.change * 100;
      return `${pp > 0 ? '+' : pp < 0 ? '-' : ''}${Math.abs(pp).toFixed(1)} pp`;
    }
    case 'count': {
      const pct = kpi.change_pct === null ? '' : ` (${formatPct(kpi.change_pct, { signed: true })})`;
      return `${kpi.change > 0 ? '+' : ''}${fmtInt(kpi.change)}${pct}`;
    }
  }
}

/** Relative change ratio of cur vs prev; null when prev is missing/zero. */
export function relChange(cur: number, prev: number | null): number | null {
  if (prev === null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export function signedMoney(n: number | null, ccy: string): string {
  return n === null ? '—' : formatMoney(n, ccy, { signed: true });
}

export function yesNo(b: boolean): string {
  return b ? 'Yes' : 'No';
}

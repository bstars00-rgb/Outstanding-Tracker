import { formatMoney } from '@core/money';

export interface OriginalAmount {
  amount: number;
  currency: string;
}

interface MoneyProps {
  amount: number | null | undefined;
  currency: string;
  compact?: boolean;
  signed?: boolean;
  /** Original-currency amount to show alongside the reporting equivalent. */
  original?: OriginalAmount | null;
  /**
   * Several original-currency amounts (multi-currency customers): each on its own line.
   * A single entry in the reporting currency is omitted (it would repeat the main figure).
   */
  originals?: OriginalAmount[] | null;
  /** Colour positive/negative values (for change columns). */
  tone?: boolean;
  className?: string;
}

/** Original-currency lines worth showing under a reporting-currency figure. */
export function originalLines(currency: string, original?: OriginalAmount | null, originals?: OriginalAmount[] | null): OriginalAmount[] {
  if (originals && originals.length > 0) return originals.length > 1 ? originals : originals.filter((o) => o.currency !== currency);
  return original && original.currency !== currency ? [original] : [];
}

/** Consistent money formatting. Always uses formatMoney; compact values expose the full value as a tooltip. */
export function Money({ amount, currency, compact, signed, original, originals, tone, className }: MoneyProps) {
  if (amount === null || amount === undefined) return <span className={`tnum muted ${className ?? ''}`}>—</span>;
  const text = formatMoney(amount, currency, { compact, signed });
  const full = compact ? formatMoney(amount, currency, { signed }) : undefined;
  const color = tone ? (amount > 0 ? 'var(--critical-text)' : amount < 0 ? 'var(--good-text)' : undefined) : undefined;
  const lines = originalLines(currency, original, originals);
  return (
    <span className={`tnum ${className ?? ''}`} title={full} style={color ? { color } : undefined}>
      {text}
      {lines.map((o) => (
        <span className="cell-sub" key={o.currency}>
          {formatMoney(o.amount, o.currency)}
        </span>
      ))}
    </span>
  );
}

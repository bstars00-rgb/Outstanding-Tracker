import { formatMoney } from '@core/money';

interface MoneyProps {
  amount: number | null | undefined;
  currency: string;
  compact?: boolean;
  signed?: boolean;
  /** Original-currency amount to show alongside the reporting equivalent. */
  original?: { amount: number; currency: string } | null;
  /** Colour positive/negative values (for change columns). */
  tone?: boolean;
  className?: string;
}

/** Consistent money formatting. Always uses formatMoney; compact values expose the full value as a tooltip. */
export function Money({ amount, currency, compact, signed, original, tone, className }: MoneyProps) {
  if (amount === null || amount === undefined) return <span className={`tnum muted ${className ?? ''}`}>—</span>;
  const text = formatMoney(amount, currency, { compact, signed });
  const full = compact ? formatMoney(amount, currency, { signed }) : undefined;
  const color = tone ? (amount > 0 ? 'var(--critical-text)' : amount < 0 ? 'var(--good-text)' : undefined) : undefined;
  const showOriginal = original && original.currency !== currency;
  return (
    <span className={`tnum ${className ?? ''}`} title={full} style={color ? { color } : undefined}>
      {text}
      {showOriginal && <span className="cell-sub">{formatMoney(original.amount, original.currency)}</span>}
    </span>
  );
}

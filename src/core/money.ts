import type { CurrencyCode, FxRate, FxTable, ISODate } from './types';

export interface Converted {
  value: number;
  rate: number;
  rate_date: ISODate;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function findRate(fx: FxTable, currency: CurrencyCode): FxRate | null {
  if (currency === fx.reporting_currency) {
    return { currency, rate_to_reporting: 1, rate_date: fx.as_of, source: 'identity' };
  }
  return fx.rates.find((r) => r.currency === currency) ?? null;
}

/** Convert an original-currency amount to reporting currency. Returns null when no rate is available. */
export function convert(amount: number, currency: CurrencyCode, fx: FxTable): Converted | null {
  const rate = findRate(fx, currency);
  if (!rate || !(rate.rate_to_reporting > 0)) return null;
  return { value: round2(amount * rate.rate_to_reporting), rate: rate.rate_to_reporting, rate_date: rate.rate_date };
}

/** Currencies whose minor unit is not used in practice (display without decimals). */
export const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'IDR', 'TWD']);

export function formatMoney(amount: number, currency: CurrencyCode, opts: { compact?: boolean; signed?: boolean } = {}): string {
  const zeroDec = ZERO_DECIMAL_CURRENCIES.has(currency);
  const abs = Math.abs(amount);
  let body: string;
  if (opts.compact && abs >= 1_000_000) body = (abs / 1_000_000).toFixed(2) + 'M';
  else if (opts.compact && abs >= 10_000) body = (abs / 1_000).toFixed(1) + 'K';
  else body = abs.toLocaleString('en-US', { minimumFractionDigits: zeroDec ? 0 : 2, maximumFractionDigits: zeroDec ? 0 : 2 });
  const sign = amount < 0 ? '-' : opts.signed && amount > 0 ? '+' : '';
  return `${sign}${currency} ${body}`;
}

export function formatPct(ratio: number | null, opts: { signed?: boolean; digits?: number } = {}): string {
  if (ratio === null || !Number.isFinite(ratio)) return 'n/a';
  const digits = opts.digits ?? 1;
  const v = ratio * 100;
  const sign = v < 0 ? '-' : opts.signed && v > 0 ? '+' : '';
  return `${sign}${Math.abs(v).toFixed(digits)}%`;
}

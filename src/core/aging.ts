import { daysBetween } from './dates';
import type { AgingBucket, ISODate } from './types';

/** Aging days = reference date - due date. Negative or zero => not yet overdue. */
export function agingDays(referenceDate: ISODate, dueDate: ISODate | null): number | null {
  if (!dueDate) return null;
  return daysBetween(dueDate, referenceDate);
}

export function bucketFor(aging: number | null): AgingBucket | 'UNKNOWN' {
  if (aging === null) return 'UNKNOWN';
  if (aging <= 0) return 'CURRENT';
  if (aging <= 7) return 'D1_7';
  if (aging <= 14) return 'D8_14';
  if (aging <= 30) return 'D15_30';
  if (aging <= 60) return 'D31_60';
  if (aging <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export function emptyBuckets(): Record<AgingBucket, number> {
  return { CURRENT: 0, D1_7: 0, D8_14: 0, D15_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0 };
}

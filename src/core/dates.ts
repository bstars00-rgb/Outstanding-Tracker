import type { ISODate, ISODateTime } from './types';

const DAY_MS = 86_400_000;

export function isISODate(value: unknown): value is ISODate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
}

export function toUTCDate(iso: ISODate): Date {
  return new Date(iso + 'T00:00:00Z');
}

export function isoDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (to - from). Positive when `to` is later. */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTCDate(to).getTime() - toUTCDate(from).getTime()) / DAY_MS);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = toUTCDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function maxDate(a: ISODate | null, b: ISODate | null): ISODate | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Most recent Saturday on or before the given date (report cadence). */
export function latestSaturday(iso: ISODate): ISODate {
  const d = toUTCDate(iso);
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const back = (dow + 1) % 7; // Sat->0, Sun->1, Mon->2 ...
  return addDays(iso, -back);
}

export function todayISO(now: Date = new Date()): ISODate {
  return isoDate(now);
}

/** Report week: 7 days ending on the reference date (inclusive). */
export function reportWeek(referenceDate: ISODate, previousSnapshotDate: ISODate | null): { start: ISODate; end: ISODate } {
  const start = previousSnapshotDate ? addDays(previousSnapshotDate, 1) : addDays(referenceDate, -6);
  return { start, end: referenceDate };
}

export function inRange(date: ISODate | null, start: ISODate, end: ISODate): boolean {
  return !!date && date >= start && date <= end;
}

/** 09:00 local in the given IANA timezone expressed as UTC ISO string for a given date. */
export function localTimeToUTC(date: ISODate, hour: number, minute: number, timeZone: string): ISODateTime {
  // Iterate: guess UTC then correct by the zone offset observed at that instant.
  const guess = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  const offsetMin = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offsetMin * 60_000).toISOString();
}

export function tzOffsetMinutes(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUTC - at.getTime()) / 60_000);
}

export function formatInTimeZone(iso: ISODateTime, timeZone: string): string {
  const d = new Date(iso);
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
}

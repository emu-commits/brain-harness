import type { ISODate } from '../model/types';

// Calendar arithmetic on 'YYYY-MM-DD' strings. Uses UTC internally so results never depend
// on the host time zone. Never reads the clock.

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  return formatDay(toDay(s)) === s;
}

export function isYearMonth(s: unknown): s is string {
  if (typeof s !== 'string' || !MONTH_RE.test(s)) return false;
  const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** Days since 1970-01-01. */
export function toDay(date: ISODate): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function formatDay(day: number): ISODate {
  const dt = new Date(day * DAY_MS);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(date: ISODate, n: number): ISODate {
  return formatDay(toDay(date) + n);
}

/** b − a in days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return toDay(b) - toDay(a);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: ISODate): number {
  return new Date(toDay(date) * DAY_MS).getUTCDay();
}

export function yearMonth(date: ISODate): string {
  return date.slice(0, 7);
}

/** Months since year 0, for 'YYYY-MM' arithmetic. */
export function monthIndex(ym: string): number {
  return Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1);
}

export function formatMonthIndex(i: number): string {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

export function addMonths(ym: string, n: number): string {
  return formatMonthIndex(monthIndex(ym) + n);
}

/** Last calendar day of a 'YYYY-MM' month. */
export function monthEnd(ym: string): ISODate {
  const next = addMonths(ym, 1);
  return addDays(`${next}-01`, -1);
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** Whole days elapsed between two ISO timestamps (floored). */
export function daysBetweenTimes(a: string, b: string): number {
  return Math.floor((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

/** 'HH:MM' → minutes since midnight. */
export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

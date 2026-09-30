import type { Cents, ISODate, Range } from '../core/model/types';

// Display formatting. ISO dates are formatted in UTC so a calendar date never shifts.

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const monthFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function fmtDate(d: ISODate | null | undefined): string {
  if (!d) return '—';
  return dateFmt.format(new Date(`${d}T00:00:00Z`));
}

export function fmtShortDate(d: ISODate): string {
  return shortDateFmt.format(new Date(`${d}T00:00:00Z`));
}

export function fmtMonth(ym: string | null | undefined): string {
  if (!ym) return '—';
  return monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
}

export function fmtMinutes(m: number): string {
  const r = Math.round(m);
  if (r < 60) return `${r} min`;
  const h = Math.floor(r / 60);
  const mm = r % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}

export function fmtMinutesRange(r: Range | undefined): string {
  if (!r) return 'No estimate';
  if (r.high < 60 || r.low < 60)
    return r.low === r.high ? `${r.low} min` : `${r.low}–${r.high} min`;
  const h = (x: number) =>
    x % 60 === 0 ? String(x / 60) : (x / 60).toFixed(1).replace(/\.0$/, '');
  return r.low === r.high ? `${h(r.low)} h` : `${h(r.low)}–${h(r.high)} h`;
}

export function fmtDays(n: number): string {
  const a = Math.abs(n);
  return `${a} day${a === 1 ? '' : 's'}`;
}

export function fmtMoney(c: Cents | null | undefined, currency = 'USD'): string {
  if (c === null || c === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: Math.abs(c) >= 100000 ? 0 : 2,
    }).format(c / 100);
  } catch {
    return `${(c / 100).toFixed(2)} ${currency}`;
  }
}

/** Parse a user-typed amount like "1,200.50" into integer cents. */
export function parseMoney(s: string): Cents | null {
  const t = s.replace(/[^0-9.-]/g, '');
  if (!t || t === '-' || t === '.') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function centsToInput(c: Cents | undefined): string {
  return c === undefined ? '' : (c / 100).toFixed(2).replace(/\.00$/, '');
}

export function relDays(n: number): string {
  if (n === 0) return 'no change';
  return n > 0 ? `+${fmtDays(n)}` : `−${fmtDays(n)}`;
}

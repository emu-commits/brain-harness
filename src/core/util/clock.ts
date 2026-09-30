import type { ISODate, ISOTime } from '../model/types';

/** The only way core code learns the current time. Injected by the app; faked in tests. */
export interface Clock {
  /** Full ISO 8601 timestamp. */
  now(): ISOTime;
  /** The user's local calendar date, 'YYYY-MM-DD'. */
  today(): ISODate;
  /** The user's local wall time, 'HH:MM', and weekday (0 = Sunday). */
  localTime(): { weekday: number; hhmm: string };
}

export function fixedClock(now: ISOTime, today?: ISODate, hhmm = '09:00'): Clock {
  const date = today ?? now.slice(0, 10);
  return {
    now: () => now,
    today: () => date,
    localTime: () => ({ weekday: weekdayOfDate(date), hhmm }),
  };
}

function weekdayOfDate(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

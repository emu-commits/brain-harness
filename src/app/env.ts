import type { Clock } from '../core/util/clock';
import type { IdGen } from '../core/util/ids';
import { uuidV4FromBytes } from '../core/util/ids';

// Browser implementations of the core's injected Clock and IdGen.

const pad = (n: number) => String(n).padStart(2, '0');

export const browserClock: Clock = {
  now: () => new Date().toISOString(),
  today: () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },
  localTime: () => {
    const d = new Date();
    return { weekday: d.getDay(), hhmm: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  },
};

export const browserIds: IdGen = {
  next: () =>
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : uuidV4FromBytes(crypto.getRandomValues(new Uint8Array(16))),
};

import type { Cents } from '../model/types';

/** Round half away from zero to integer cents. Applied at every money step. */
export function roundCents(x: number): Cents {
  if (!Number.isFinite(x)) throw new Error(`roundCents: non-finite value ${x}`);
  // Nudge by a tiny epsilon so values like 2.4999999999 that are really 2.5 round correctly.
  const abs = Math.abs(x);
  const r = Math.floor(abs + 0.5 + 1e-9);
  if (r === 0) return 0;
  return x < 0 ? -r : r;
}

export function isCents(x: unknown): x is Cents {
  return typeof x === 'number' && Number.isInteger(x);
}

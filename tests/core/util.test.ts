import { describe, expect, it } from 'vitest';
import { roundCents } from '../../src/core/util/money';
import {
  addDays,
  addMonths,
  diffDays,
  isISODate,
  monthEnd,
  weekday,
} from '../../src/core/util/dates';
import { hashValue, stableStringify } from '../../src/core/util/hash';
import { median } from '../../src/core/util/stats';
import { uuidV4FromBytes } from '../../src/core/util/ids';

describe('roundCents', () => {
  it('rounds half away from zero', () => {
    expect(roundCents(2.5)).toBe(3);
    expect(roundCents(-2.5)).toBe(-3);
    expect(roundCents(2.4999)).toBe(2);
    expect(roundCents(-0.4)).toBe(0);
    expect(Object.is(roundCents(-0.4), -0)).toBe(false);
    expect(roundCents(1.005 * 100)).toBe(101);
  });
  it('rejects non-finite input', () => expect(() => roundCents(NaN)).toThrow());
});

describe('dates', () => {
  it('does calendar arithmetic independent of time zone', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
    expect(weekday('2026-01-04')).toBe(0);
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-02-28')).toBe(true);
  });
});

describe('hash', () => {
  it('is independent of key order', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
    expect(hashValue({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('misc', () => {
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('uuid v4 shape', () => {
    expect(uuidV4FromBytes(new Uint8Array(16).fill(255))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

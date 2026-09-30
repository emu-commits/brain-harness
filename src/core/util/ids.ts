/** The only way core code creates ids. Injected by the app; deterministic in tests. */
export interface IdGen {
  next(): string;
}

/** Deterministic UUID-shaped ids for tests and fixtures: 00000000-0000-4000-8000-000000000001, … */
export function sequentialIdGen(start = 1): IdGen {
  let n = start;
  return {
    next() {
      const hex = (n++).toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${hex}`;
    },
  };
}

/** Formats 16 random bytes as a UUID v4. The caller supplies the randomness. */
export function uuidV4FromBytes(bytes: Uint8Array): string {
  const b = Array.from(bytes.slice(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

import type { Clock } from '../util/clock';
import type { IdGen } from '../util/ids';
import type { Cents, ForecastSnapshot, ID, ISODate, ScenarioId } from '../model/types';
import { SCENARIOS } from '../model/types';
import { cmp } from '../model/factories';
import { diffDays } from '../util/dates';
import { hashValue, stableStringify } from '../util/hash';
import type { Forecast, ForecastInputs } from './scenarios';
import { ENGINE_VERSION, runScenario } from './scenarios';

// Snapshots, "What changed" diffs and attribution (SPEC §9.10).

export function hashInputs(inputs: ForecastInputs): string {
  return hashValue(inputs);
}

export function createSnapshot(
  inputs: ForecastInputs,
  outputs: Forecast,
  reason: ForecastSnapshot['reason'],
  ids: IdGen,
  clock: Clock,
): ForecastSnapshot {
  return {
    id: ids.next(),
    goalId: inputs.goal.id,
    createdAt: clock.now(),
    engineVersion: ENGINE_VERSION,
    reason,
    inputsHash: hashInputs(inputs),
    inputs,
    outputs,
  };
}

// ---- Input changes ----

export interface InputChange {
  /** e.g. 'tasks', 'capacity', 'goal'. */
  collection: string;
  /** Object id within the collection ('' for singletons). */
  id: string;
  /** Field name, or '' for whole-object add/remove. */
  field: string;
  kind: 'added' | 'removed' | 'changed';
  old?: unknown;
  new?: unknown;
}

const ENTITY_COLLECTIONS = [
  'milestones',
  'tasks',
  'dependencies',
  'accounts',
  'cashFlows',
  'revenueStreams',
] as const;
const OBJECT_FIELDS = ['goal', 'capacity', 'scenario'] as const;
const MAP_FIELDS = ['loggedMinutes', 'calibration'] as const;
const SCALARS = ['today', 'blockedAssumeDays'] as const;

const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

function fieldDiff(
  collection: string,
  id: string,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): InputChange[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(cmp);
  const out: InputChange[] = [];
  for (const k of keys) {
    if (!same(a[k], b[k]))
      out.push({ collection, id, field: k, kind: 'changed', old: a[k], new: b[k] });
  }
  return out;
}

export function diffInputs(a: ForecastInputs, b: ForecastInputs): InputChange[] {
  const out: InputChange[] = [];
  for (const c of SCALARS) {
    if (!same(a[c], b[c]))
      out.push({ collection: c, id: '', field: '', kind: 'changed', old: a[c], new: b[c] });
  }
  for (const c of OBJECT_FIELDS) {
    out.push(
      ...fieldDiff(
        c,
        '',
        a[c] as unknown as Record<string, unknown>,
        b[c] as unknown as Record<string, unknown>,
      ),
    );
  }
  for (const c of MAP_FIELDS) out.push(...fieldDiff(c, '', a[c], b[c]));
  for (const c of ENTITY_COLLECTIONS) {
    const am = new Map((a[c] as { id: ID }[]).map((x) => [x.id, x]));
    const bm = new Map((b[c] as { id: ID }[]).map((x) => [x.id, x]));
    for (const id of [...new Set([...am.keys(), ...bm.keys()])].sort(cmp)) {
      const x = am.get(id);
      const y = bm.get(id);
      if (x && !y) out.push({ collection: c, id, field: '', kind: 'removed', old: x });
      else if (!x && y) out.push({ collection: c, id, field: '', kind: 'added', new: y });
      else if (x && y) {
        out.push(
          ...fieldDiff(
            c,
            id,
            x as unknown as Record<string, unknown>,
            y as unknown as Record<string, unknown>,
          ),
        );
      }
    }
  }
  return out;
}

/** Apply one change to a copy of `inputs`. */
export function applyChange(inputs: ForecastInputs, ch: InputChange): ForecastInputs {
  const next = structuredClone(inputs) as unknown as Record<string, unknown>;
  const col = ch.collection;
  if ((SCALARS as readonly string[]).includes(col)) {
    next[col] = structuredClone(ch.new);
  } else if (
    (OBJECT_FIELDS as readonly string[]).includes(col) ||
    (MAP_FIELDS as readonly string[]).includes(col)
  ) {
    const obj = next[col] as Record<string, unknown>;
    if (ch.new === undefined) delete obj[ch.field];
    else obj[ch.field] = structuredClone(ch.new);
  } else {
    const arr = next[col] as { id: ID }[];
    if (ch.kind === 'added') {
      arr.push(structuredClone(ch.new) as { id: ID });
      arr.sort((x, y) => cmp(x.id, y.id));
    } else if (ch.kind === 'removed') {
      next[col] = arr.filter((x) => x.id !== ch.id);
    } else {
      const row = arr.find((x) => x.id === ch.id) as Record<string, unknown> | undefined;
      if (row) {
        if (ch.new === undefined) delete row[ch.field];
        else row[ch.field] = structuredClone(ch.new);
      }
    }
  }
  return next as unknown as ForecastInputs;
}

// ---- Output deltas ----

export interface DateDelta {
  old: ISODate | null;
  new: ISODate | null;
  days: number | null;
}

export interface ScenarioDelta {
  goalCompletion: DateDelta;
  milestones: Record<ID, DateDelta>;
  totalCost: { old: Cents; new: Cents; delta: Cents };
  runwayExhaustedMonth: { old: string | null; new: string | null };
  netWorthAtTarget: { old: Cents | null; new: Cents | null; delta: Cents | null };
}

const dateDelta = (o: ISODate | null, n: ISODate | null): DateDelta => ({
  old: o,
  new: n,
  days: o && n ? diffDays(o, n) : null,
});

export function outputDeltas(a: Forecast, b: Forecast): Record<ScenarioId, ScenarioDelta> {
  const out = {} as Record<ScenarioId, ScenarioDelta>;
  for (const s of SCENARIOS) {
    const x = a[s];
    const y = b[s];
    const mIds = [
      ...new Set([
        ...Object.keys(x.schedule?.milestones ?? {}),
        ...Object.keys(y.schedule?.milestones ?? {}),
      ]),
    ].sort(cmp);
    const milestones: Record<ID, DateDelta> = {};
    for (const m of mIds) {
      milestones[m] = dateDelta(
        x.schedule?.milestones[m] ?? null,
        y.schedule?.milestones[m] ?? null,
      );
    }
    out[s] = {
      goalCompletion: dateDelta(x.goalCompletion, y.goalCompletion),
      milestones,
      totalCost: { old: x.totalCost, new: y.totalCost, delta: y.totalCost - x.totalCost },
      runwayExhaustedMonth: { old: x.runwayExhaustedMonth, new: y.runwayExhaustedMonth },
      netWorthAtTarget: {
        old: x.netWorthAtTarget,
        new: y.netWorthAtTarget,
        delta:
          x.netWorthAtTarget !== null && y.netWorthAtTarget !== null
            ? y.netWorthAtTarget - x.netWorthAtTarget
            : null,
      },
    };
  }
  return out;
}

// ---- Attribution ----

export interface Attribution {
  change: InputChange;
  /** Isolated effect on the base goal completion date, in days (null if not computable). */
  goalDays: number | null;
  /** Isolated effect on base net worth at the target date, in cents. */
  netWorthCents: number | null;
}

export const ATTRIBUTION_CAP = 20;

/**
 * Approximate contribution of each input change: apply it alone to `a`'s inputs and recompute
 * the base scenario. Effects are not strictly additive. Returns the 20 largest.
 */
export function attribute(a: ForecastInputs, changes: readonly InputChange[]): Attribution[] {
  const base = runScenario(a, 'base');
  const res: Attribution[] = changes.map((ch) => {
    const r = runScenario(applyChange(a, ch), 'base');
    return {
      change: ch,
      goalDays:
        base.goalCompletion && r.goalCompletion
          ? diffDays(base.goalCompletion, r.goalCompletion)
          : null,
      netWorthCents:
        base.netWorthAtTarget !== null && r.netWorthAtTarget !== null
          ? r.netWorthAtTarget - base.netWorthAtTarget
          : null,
    };
  });
  const mag = (x: Attribution) =>
    [Math.abs(x.goalDays ?? 0), Math.abs(x.netWorthCents ?? 0)] as const;
  return res
    .filter((x) => (x.goalDays ?? 0) !== 0 || (x.netWorthCents ?? 0) !== 0)
    .sort((x, y) => {
      const [xd, xc] = mag(x);
      const [yd, yc] = mag(y);
      return yd - xd || yc - xc || cmp(changeKey(x.change), changeKey(y.change));
    })
    .slice(0, ATTRIBUTION_CAP);
}

export const changeKey = (c: InputChange) => `${c.collection}/${c.id}/${c.field}`;

export interface SnapshotDiff {
  inputChanges: InputChange[];
  outputDeltas: Record<ScenarioId, ScenarioDelta>;
  attribution: Attribution[];
}

export function diffSnapshots(a: ForecastSnapshot, b: ForecastSnapshot): SnapshotDiff {
  const ai = a.inputs as ForecastInputs;
  const bi = b.inputs as ForecastInputs;
  const inputChanges = diffInputs(ai, bi);
  return {
    inputChanges,
    outputDeltas: outputDeltas(a.outputs as Forecast, b.outputs as Forecast),
    attribution: attribute(ai, inputChanges),
  };
}

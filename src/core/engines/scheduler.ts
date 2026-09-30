import type { Dependency, ID, ISODate, Pick, Task, WeekMinutes } from '../model/types';
import { cmp } from '../model/factories';
import { addDays, diffDays, weekday } from '../util/dates';
import { round } from '../util/stats';
import type { Result } from '../util/result';
import { err, ok } from '../util/result';
import { buildGraph, topoSort } from './graph';
import { computeCpm } from './cpm';

// Single-person, capacity-based scheduler (SPEC §9.3). A day-by-day simulation from today.

export type ScheduleTask = Pick_<
  Task,
  | 'id'
  | 'milestoneId'
  | 'kind'
  | 'status'
  | 'estimateMinutes'
  | 'waitDays'
  | 'priority'
  | 'category'
  | 'earliestStart'
  | 'targetDate'
  | 'createdAt'
  | 'completedAt'
>;
type Pick_<T, K extends keyof T> = { [P in K]: T[P] };

export interface ScheduleInput {
  today: ISODate;
  tasks: readonly ScheduleTask[];
  dependencies: readonly Dependency[];
  milestoneIds: readonly ID[];
  minutesByWeekday: WeekMinutes;
  loggedMinutes: Readonly<Record<ID, number>>;
  pick: Pick;
  durationMult: number;
  capacityMult: number;
  /** Accepted calibration multipliers by category; '*' applies to every category without its own. */
  calibration: Readonly<Record<string, number>>;
  blockedAssumeDays: number;
  horizonDays: number;
}

export interface ScheduledTask {
  start: ISODate | null;
  finish: ISODate;
  remainingMinutes: number;
  durationDays: number;
  float: number;
  critical: boolean;
  /** User-blocked task scheduled as if unblocked after blockedAssumeDays. */
  assumedUnblock?: true;
  /** No estimate entered; scheduled at the 15-minute minimum. */
  unestimated?: true;
  calibration?: number;
}

export interface Schedule {
  tasks: Record<ID, ScheduledTask>;
  /** Unfinished tasks in the order the simulation started them. */
  order: ID[];
  milestones: Record<ID, ISODate | null>;
  completion: ISODate | null;
  /** Minutes of work planned per day, only days with work. */
  daily: [ISODate, number][];
  trace: {
    formula: 'capacitySchedule';
    pick: Pick;
    durationMult: number;
    capacityMult: number;
    averageDailyMinutes: number;
    notes: string[];
  };
}

export type ScheduleError =
  | { kind: 'cycle'; taskIds: ID[] }
  | { kind: 'noCapacity' }
  | { kind: 'unschedulable'; taskIds: ID[] };

const EPS = 1e-9;
const MIN_REMAINING = 15;

export function calibrationFor(cal: Readonly<Record<string, number>>, category?: string): number {
  if (category !== undefined && cal[category] !== undefined) return cal[category]!;
  return cal['*'] ?? 1;
}

/** Remaining minutes for a work/decision task under a scenario. */
export function remainingMinutes(
  t: ScheduleTask,
  pick: Pick,
  durationMult: number,
  calibration: Readonly<Record<string, number>>,
  logged: number,
): number {
  if (t.status === 'completed' || t.status === 'skipped') return 0;
  const est = t.estimateMinutes ? t.estimateMinutes[pick] : 0;
  const r = Math.max(est * durationMult * calibrationFor(calibration, t.category) - logged, 0);
  return r <= EPS ? MIN_REMAINING : r;
}

export function schedule(input: ScheduleInput): Result<Schedule, ScheduleError> {
  const { today, pick, durationMult, capacityMult } = input;
  const graph = buildGraph(input.tasks, input.dependencies);
  const topo = topoSort(graph);
  if (topo.cyclic.length) return err({ kind: 'cycle', taskIds: topo.cyclic });

  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const live = graph.nodes.map((id) => byId.get(id)!);
  const weekTotal = input.minutesByWeekday.reduce((a, b) => a + b, 0) * capacityMult;
  const avgDaily = weekTotal / 7;
  const notes: string[] = [];

  const isWork = (t: ScheduleTask) => t.kind !== 'wait';
  const open = live.filter((t) => t.status !== 'completed');
  if (open.some(isWork) && weekTotal <= EPS) return err({ kind: 'noCapacity' });

  // Per-task simulation state.
  const remaining = new Map<ID, number>();
  const waitLen = new Map<ID, number>();
  const minStart = new Map<ID, number>();
  const finishDay = new Map<ID, number>();
  const startDay = new Map<ID, number>();
  const assumed = new Set<ID>();
  const unestimated = new Set<ID>();

  for (const t of live) {
    if (t.status === 'completed') {
      const done = t.completedAt ? t.completedAt.slice(0, 10) : today;
      finishDay.set(t.id, Math.min(0, diffDays(today, done)));
      continue;
    }
    let ms = t.earliestStart ? Math.max(0, diffDays(today, t.earliestStart)) : 0;
    if (t.status === 'blocked') {
      ms = Math.max(ms, input.blockedAssumeDays);
      assumed.add(t.id);
    }
    minStart.set(t.id, ms);
    if (isWork(t)) {
      if (!t.estimateMinutes) unestimated.add(t.id);
      remaining.set(
        t.id,
        remainingMinutes(t, pick, durationMult, input.calibration, input.loggedMinutes[t.id] ?? 0),
      );
    } else {
      waitLen.set(t.id, Math.ceil((t.waitDays ? t.waitDays[pick] : 0) * durationMult - EPS));
    }
  }
  if (assumed.size)
    notes.push(
      `${assumed.size} blocked task(s) assumed unblocked after ${input.blockedAssumeDays} days`,
    );
  if (unestimated.size)
    notes.push(`${unestimated.size} task(s) have no estimate (15-minute minimum used)`);

  // Critical path on calendar-day durations, for ordering and highlighting.
  const durations = new Map<ID, number>();
  for (const t of open) {
    durations.set(
      t.id,
      isWork(t) ? remaining.get(t.id)! / Math.max(avgDaily, EPS) : waitLen.get(t.id)!,
    );
  }
  const cpm = computeCpm({
    graph,
    durations,
    pinnedFinish: new Map([...finishDay.entries()]),
    minStart,
  });

  const orderKey = (a: ScheduleTask, b: ScheduleTask): number => {
    const ca = cpm.nodes.get(a.id)!;
    const cb = cpm.nodes.get(b.id)!;
    if (ca.critical !== cb.critical) return ca.critical ? -1 : 1;
    if (Math.abs(ca.float - cb.float) > EPS) return ca.float - cb.float;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ta = a.targetDate ?? '9999-12-31';
    const tb = b.targetDate ?? '9999-12-31';
    return cmp(ta, tb) || cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id);
  };

  const readyOn = (t: ScheduleTask, d: number): boolean => {
    if ((minStart.get(t.id) ?? 0) > d) return false;
    for (const e of graph.preds.get(t.id) ?? []) {
      const f = finishDay.get(e.from);
      if (f === undefined || f + e.lagDays > d) return false;
    }
    return true;
  };

  const pendingWaits = open.filter((t) => !isWork(t)).sort(orderKey);
  const pendingWork = open.filter(isWork).sort(orderKey);
  const waitEnds = new Map<ID, number>();
  const started: ID[] = [];

  const startWaits = (d: number) => {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const t of pendingWaits) {
        if (startDay.has(t.id) || !readyOn(t, d)) continue;
        startDay.set(t.id, d);
        started.push(t.id);
        const end = d + waitLen.get(t.id)!;
        waitEnds.set(t.id, end);
        if (end <= d) {
          finishDay.set(t.id, d);
          progressed = true;
        }
      }
    }
  };

  const daily: [ISODate, number][] = [];
  let current: ScheduleTask | null = null;
  let unfinished = open.length;
  const countDone = () => open.filter((t) => finishDay.has(t.id)).length;

  for (let d = 0; d <= input.horizonDays && unfinished > 0; d++) {
    // Waits whose time has elapsed finish at the start of the day.
    for (const [id, end] of waitEnds) if (!finishDay.has(id) && end <= d) finishDay.set(id, end);
    startWaits(d);

    let cap = input.minutesByWeekday[weekday(addDays(today, d))]! * capacityMult;
    let used = 0;
    while (cap > EPS) {
      if (!current) {
        current = pendingWork.find((t) => !finishDay.has(t.id) && readyOn(t, d)) ?? null;
        if (!current) break;
        if (!startDay.has(current.id)) {
          startDay.set(current.id, d);
          started.push(current.id);
        }
      }
      const rem = remaining.get(current.id)!;
      const use = Math.min(cap, rem);
      remaining.set(current.id, rem - use);
      cap -= use;
      used += use;
      if (rem - use <= EPS) {
        finishDay.set(current.id, d);
        current = null;
        startWaits(d);
      }
    }
    if (used > EPS) daily.push([addDays(today, d), round(used, 2)]);
    unfinished = open.length - countDone();
  }

  if (unfinished > 0) {
    return err({
      kind: 'unschedulable',
      taskIds: open
        .filter((t) => !finishDay.has(t.id))
        .map((t) => t.id)
        .sort(cmp),
    });
  }

  const tasks: Record<ID, ScheduledTask> = {};
  for (const t of live) {
    const node = cpm.nodes.get(t.id)!;
    const s = startDay.get(t.id);
    const st: ScheduledTask = {
      start: s === undefined ? null : addDays(today, s),
      finish: addDays(today, finishDay.get(t.id)!),
      remainingMinutes:
        t.status === 'completed' || !isWork(t)
          ? 0
          : round(
              remainingMinutes(
                t,
                pick,
                durationMult,
                input.calibration,
                input.loggedMinutes[t.id] ?? 0,
              ),
              2,
            ),
      durationDays: round(durations.get(t.id) ?? 0, 4),
      float: round(node.float, 4),
      critical: node.critical,
    };
    if (assumed.has(t.id)) st.assumedUnblock = true;
    if (unestimated.has(t.id)) st.unestimated = true;
    if (isWork(t) && t.status !== 'completed') {
      const c = calibrationFor(input.calibration, t.category);
      if (c !== 1) st.calibration = c;
    }
    tasks[t.id] = st;
  }

  const milestones: Record<ID, ISODate | null> = {};
  for (const m of input.milestoneIds) {
    const fins = live.filter((t) => t.milestoneId === m).map((t) => tasks[t.id]!.finish);
    milestones[m] = fins.length ? fins.reduce((a, b) => (a > b ? a : b)) : null;
  }
  const mDates = Object.values(milestones).filter((x): x is ISODate => x !== null);
  const emptyMilestones = input.milestoneIds.filter((m) => milestones[m] === null).length;
  if (emptyMilestones)
    notes.push(`${emptyMilestones} milestone(s) have no tasks and no modeled date`);
  const completion = mDates.length ? mDates.reduce((a, b) => (a > b ? a : b)) : null;

  return ok({
    tasks,
    order: started.filter((id) => byId.get(id)!.status !== 'completed'),
    milestones,
    completion,
    daily,
    trace: {
      formula: 'capacitySchedule',
      pick,
      durationMult,
      capacityMult,
      averageDailyMinutes: round(avgDaily, 2),
      notes,
    },
  });
}

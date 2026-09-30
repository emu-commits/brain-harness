import type { Capacity, Dependency, ID, ISODate, Task } from '../model/types';
import { cmp } from '../model/factories';
import { hhmmToMinutes } from '../util/dates';
import { buildGraph } from './graph';

// Next-action selection (SPEC §9.11).

/** Work/decision tasks the user can start today: not blocked, every predecessor resolved. */
export function readyTaskIds(
  tasks: readonly Task[],
  deps: readonly Dependency[],
  today: ISODate,
): Set<ID> {
  const g = buildGraph(tasks, deps);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Set<ID>();
  for (const t of tasks) {
    if (t.kind === 'wait' || (t.status !== 'ready' && t.status !== 'inProgress')) continue;
    if (t.earliestStart && t.earliestStart > today) continue;
    const preds = g.preds.get(t.id) ?? [];
    if (preds.every((e) => byId.get(e.from)?.status === 'completed')) out.add(t.id);
  }
  return out;
}

export function inPeakWindow(capacity: Capacity, weekday: number, hhmm: string): boolean {
  const now = hhmmToMinutes(hhmm);
  return (capacity.peakWindows ?? []).some(
    (w) => w.weekday === weekday && hhmmToMinutes(w.start) <= now && now < hhmmToMinutes(w.end),
  );
}

export interface NextActionInput {
  tasks: readonly Task[];
  dependencies: readonly Dependency[];
  /** The base schedule's start order, if a schedule exists. */
  scheduleOrder?: readonly ID[];
  today: ISODate;
  capacity: Capacity;
  local: { weekday: number; hhmm: string };
}

export interface NextAction {
  taskId: ID;
  /** Other ready tasks, in the same order. */
  alternatives: ID[];
  energyPreference: 'deep' | 'shallow' | null;
}

/**
 * First ready task in scheduler order. With peak windows configured, prefer `deep` tasks inside
 * a peak window and `shallow` ones outside it. Without peak windows there is no energy
 * adjustment. The user can always pick any other ready task.
 */
export function selectNextAction(input: NextActionInput): NextAction | null {
  const ready = readyTaskIds(input.tasks, input.dependencies, input.today);
  if (!ready.size) return null;
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const fallback = (a: Task, b: Task) =>
    a.priority - b.priority || cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id);
  const ordered: ID[] = [];
  for (const id of input.scheduleOrder ?? [])
    if (ready.has(id) && !ordered.includes(id)) ordered.push(id);
  const rest = [...ready]
    .filter((id) => !ordered.includes(id))
    .map((id) => byId.get(id)!)
    .sort(fallback);
  ordered.push(...rest.map((t) => t.id));

  let pref: 'deep' | 'shallow' | null = null;
  if (input.capacity.peakWindows?.length) {
    pref = inPeakWindow(input.capacity, input.local.weekday, input.local.hhmm) ? 'deep' : 'shallow';
  }
  const chosen = (pref && ordered.find((id) => byId.get(id)!.energy === pref)) ?? ordered[0]!;
  return {
    taskId: chosen,
    alternatives: ordered.filter((id) => id !== chosen),
    energyPreference: pref,
  };
}

import type { Clock } from '../util/clock';
import type { IdGen } from '../util/ids';
import type {
  Capacity,
  Goal,
  ID,
  ISODate,
  Milestone,
  Range,
  ScenarioSettings,
  Settings,
  Task,
  Workspace,
} from './types';
import { TABLES } from './types';

export function emptyWorkspace(): Workspace {
  const ws = {} as Workspace;
  for (const t of TABLES) (ws as unknown as Record<string, unknown[]>)[t] = [];
  return ws;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  resumeThresholdDays: 3,
  maxGapsPerSession: 5,
  splitThresholdMinutes: 480,
  blockedAssumeDays: 7,
  stuck: { sessions: 3, overrunFactor: 1.5, blockedDays: 14 },
  calibration: { window: 10, minTasks: 5 },
  woopEveryDays: 3,
};

export function getSettings(ws: Workspace): Settings {
  return ws.settings[0] ?? DEFAULT_SETTINGS;
}

export function defaultScenarioSettings(goalId: ID): ScenarioSettings {
  const one = { duration: 1, capacity: 1, cost: 1, revenue: 1 };
  return {
    goalId,
    inflationAnnual: 0.03,
    horizonMonths: 120,
    multipliers: { conservative: { ...one }, base: { ...one }, optimistic: { ...one } },
  };
}

export function emptyCapacity(goalId: ID): Capacity {
  return { goalId, minutesByWeekday: [0, 0, 0, 0, 0, 0, 0] };
}

export function newGoal(ids: IdGen, clock: Clock, title: string, targetDate: ISODate): Goal {
  return {
    id: ids.next(),
    title,
    status: 'active',
    targetDate,
    currency: 'USD',
    createdAt: clock.now(),
    charter: { why: '', obstacle: '', obstaclePlan: '', premortem: [], commitments: [] },
    successCriteria: [],
    scaffoldLevel: 1,
  };
}

export function newMilestone(ids: IdGen, goalId: ID, title: string, order: number): Milestone {
  return { id: ids.next(), goalId, title, order, definitionOfDone: '' };
}

export function newTask(
  ids: IdGen,
  clock: Clock,
  goalId: ID,
  title: string,
  extra: Partial<Task> = {},
): Task {
  return {
    id: ids.next(),
    goalId,
    title,
    kind: 'work',
    definitionOfDone: '',
    status: 'ready',
    priority: 2,
    energy: 'deep',
    createdAt: clock.now(),
    ...extra,
  };
}

export function pickOf(r: Range, pick: 'low' | 'base' | 'high'): number {
  return r[pick];
}

// ---- Selectors ----

export function goalById(ws: Workspace, id: ID | undefined): Goal | undefined {
  return id ? ws.goals.find((g) => g.id === id) : undefined;
}

export function tasksOfGoal(ws: Workspace, goalId: ID): Task[] {
  return ws.tasks.filter((t) => t.goalId === goalId);
}

export function milestonesOfGoal(ws: Workspace, goalId: ID): Milestone[] {
  return ws.milestones
    .filter((m) => m.goalId === goalId)
    .sort((a, b) => a.order - b.order || cmp(a.id, b.id));
}

export function depsOfGoal(ws: Workspace, goalId: ID) {
  const ids = new Set(tasksOfGoal(ws, goalId).map((t) => t.id));
  return ws.dependencies.filter((d) => ids.has(d.fromTaskId) && ids.has(d.toTaskId));
}

export function capacityOf(ws: Workspace, goalId: ID): Capacity {
  return ws.capacities.find((c) => c.goalId === goalId) ?? emptyCapacity(goalId);
}

export function scenarioSettingsOf(ws: Workspace, goalId: ID): ScenarioSettings {
  return ws.scenarioSettings.find((s) => s.goalId === goalId) ?? defaultScenarioSettings(goalId);
}

/** Tasks in a milestone, in creation order. */
export function tasksOfMilestone(ws: Workspace, milestoneId: ID): Task[] {
  return ws.tasks
    .filter((t) => t.milestoneId === milestoneId)
    .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
}

export function loggedMinutesByTask(ws: Workspace): Record<ID, number> {
  const out: Record<ID, number> = {};
  for (const r of ws.executionRecords) out[r.taskId] = (out[r.taskId] ?? 0) + r.minutes;
  return out;
}

export function loggedCostByTask(ws: Workspace): Record<ID, number> {
  const out: Record<ID, number> = {};
  for (const r of ws.executionRecords) {
    if (r.cost !== undefined) out[r.taskId] = (out[r.taskId] ?? 0) + r.cost;
  }
  return out;
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Replace one row (matched by key) in a table, returning a new array. */
export function upsert<T>(rows: readonly T[], row: T, key: keyof T = 'id' as keyof T): T[] {
  const i = rows.findIndex((r) => r[key] === row[key]);
  if (i < 0) return [...rows, row];
  const next = rows.slice();
  next[i] = row;
  return next;
}

export function totalWeeklyMinutes(c: Capacity): number {
  return c.minutesByWeekday.reduce((a, b) => a + b, 0);
}

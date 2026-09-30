import type { Clock } from '../core/util/clock';
import type { IdGen } from '../core/util/ids';
import type {
  Cents,
  Evidence,
  ExecutionRecord,
  ID,
  Intention,
  Task,
  Workspace,
} from '../core/model/types';
import { getSettings, upsert } from '../core/model/factories';
import { withSettings } from './store';

// Small workspace transitions used by the Execute loop. Each returns a new workspace; the store
// validates and mode-checks it before anything is saved.

export function beginTask(
  ws: Workspace,
  taskId: ID,
  opts: {
    sessionId: ID;
    definitionOfDone: string;
    intention?: Intention;
    predictedMinutes?: number;
  },
  clock: Clock,
): Workspace {
  const t = ws.tasks.find((x) => x.id === taskId)!;
  const task: Task = {
    ...t,
    definitionOfDone: opts.definitionOfDone.trim(),
    status: t.status === 'completed' ? t.status : 'inProgress',
  };
  if (opts.intention) task.intention = opts.intention;
  delete task.blockedAt;
  return withSettings(
    { ...ws, tasks: upsert(ws.tasks, task) },
    {
      running: {
        taskId,
        sessionId: opts.sessionId,
        startedAt: clock.now(),
        ...(opts.predictedMinutes ? { predictedMinutes: opts.predictedMinutes } : {}),
      },
    },
  );
}

export interface SittingInput {
  minutes: number;
  cost?: Cents;
  complete: boolean;
  surprise?: string;
  evidence: Omit<Evidence, 'id' | 'taskId' | 'createdAt'>[];
}

/** Record a sitting (actual vs predicted), attach evidence, and complete or pause the task. */
export function recordSitting(
  ws: Workspace,
  input: SittingInput,
  ids: IdGen,
  clock: Clock,
): Workspace {
  const running = getSettings(ws).running;
  if (!running) return ws;
  const now = clock.now();
  const t = ws.tasks.find((x) => x.id === running.taskId)!;
  const rec: ExecutionRecord = {
    id: ids.next(),
    taskId: t.id,
    sessionId: running.sessionId,
    startedAt: running.startedAt,
    endedAt: now,
    minutes: input.minutes,
    ...(input.cost !== undefined ? { cost: input.cost } : {}),
    ...(running.predictedMinutes !== undefined
      ? { predictedMinutes: running.predictedMinutes }
      : {}),
    ...(input.surprise?.trim() ? { surprise: input.surprise.trim() } : {}),
  };
  const evidence: Evidence[] = input.evidence.map((e) => ({
    ...e,
    id: ids.next(),
    taskId: t.id,
    createdAt: now,
  }));
  const task: Task = input.complete
    ? { ...t, status: 'completed', completedAt: now }
    : { ...t, status: 'inProgress' };
  const next: Workspace = {
    ...ws,
    tasks: upsert(ws.tasks, task),
    executionRecords: [...ws.executionRecords, rec],
    evidence: [...ws.evidence, ...evidence],
  };
  const s = { ...getSettings(next) };
  delete s.running;
  return { ...next, settings: [s] };
}

export function cancelRunning(ws: Workspace): Workspace {
  const s = { ...getSettings(ws) };
  if (!s.running) return ws;
  delete s.running;
  return { ...ws, settings: [s] };
}

export function patchTask(
  ws: Workspace,
  taskId: ID,
  patch: Partial<Task>,
  clear: (keyof Task)[] = [],
): Workspace {
  const t = ws.tasks.find((x) => x.id === taskId);
  if (!t) return ws;
  const next = { ...t, ...patch };
  for (const k of clear) delete next[k];
  return { ...ws, tasks: upsert(ws.tasks, next) };
}

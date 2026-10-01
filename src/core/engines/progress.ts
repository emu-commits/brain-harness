import type { Evidence, ID, Task, Workspace } from '../model/types';
import {
  cmp,
  depsOfGoal,
  loggedMinutesByTask,
  milestonesOfGoal,
  tasksOfGoal,
} from '../model/factories';
import { buildGraph } from './graph';

// Progress you can feel (the progress principle and the goal-gradient effect): what finishing a
// task unlocked, how close its milestone is, and a log of what now exists. Mirrors only.

export interface MilestoneProgress {
  id: ID;
  title: string;
  doneTasks: number;
  totalTasks: number;
  /** Share of estimated minutes completed (by task count when nothing is estimated). */
  pct: number;
  remaining: { id: ID; title: string }[];
  reached: boolean;
}

export interface CompletionProgress {
  task: { id: ID; title: string };
  /** Successors whose predecessors are now all complete. */
  unlocked: { id: ID; title: string; kind: Task['kind'] }[];
  milestone: MilestoneProgress | null;
  goal: { doneTasks: number; totalTasks: number };
}

const live = (t: Task) => t.status !== 'skipped';

export function milestoneProgress(ws: Workspace, milestoneId: ID): MilestoneProgress | null {
  const m = ws.milestones.find((x) => x.id === milestoneId);
  if (!m) return null;
  const tasks = ws.tasks
    .filter((t) => t.milestoneId === m.id && live(t))
    .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
  const done = tasks.filter((t) => t.status === 'completed');
  const total = tasks.reduce((a, t) => a + (t.estimateMinutes?.base ?? 0), 0);
  const doneMin = done.reduce((a, t) => a + (t.estimateMinutes?.base ?? 0), 0);
  const pct =
    total > 0
      ? Math.round((doneMin / total) * 100)
      : tasks.length
        ? Math.round((done.length / tasks.length) * 100)
        : 0;
  return {
    id: m.id,
    title: m.title,
    doneTasks: done.length,
    totalTasks: tasks.length,
    pct,
    remaining: tasks
      .filter((t) => t.status !== 'completed')
      .map((t) => ({ id: t.id, title: t.title })),
    reached: tasks.length > 0 && done.length === tasks.length,
  };
}

/** Computed on the workspace *after* the task was completed. */
export function completionProgress(ws: Workspace, taskId: ID): CompletionProgress {
  const task = ws.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`completionProgress: unknown task ${taskId}`);
  const tasks = tasksOfGoal(ws, task.goalId);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const g = buildGraph(tasks, depsOfGoal(ws, task.goalId));
  const unlocked = (g.succs.get(task.id) ?? [])
    .map((e) => byId.get(e.to)!)
    .filter((s) => s.status === 'ready' || s.status === 'inProgress')
    .filter((s) => (g.preds.get(s.id) ?? []).every((e) => byId.get(e.from)?.status === 'completed'))
    .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id))
    .map((s) => ({ id: s.id, title: s.title, kind: s.kind }));
  const planned = tasks.filter((t) => live(t) && t.milestoneId);
  return {
    task: { id: task.id, title: task.title },
    unlocked,
    milestone: task.milestoneId ? milestoneProgress(ws, task.milestoneId) : null,
    goal: {
      doneTasks: planned.filter((t) => t.status === 'completed').length,
      totalTasks: planned.length,
    },
  };
}

export interface DoneEntry {
  taskId: ID;
  title: string;
  completedAt: string;
  milestoneTitle?: string;
  minutes: number;
  evidence: Evidence[];
}

/** Everything completed for a goal, newest first, with its evidence. */
export function doneLog(ws: Workspace, goalId: ID): DoneEntry[] {
  const minutes = loggedMinutesByTask(ws);
  const ms = new Map(milestonesOfGoal(ws, goalId).map((m) => [m.id, m.title]));
  return tasksOfGoal(ws, goalId)
    .filter((t) => t.status === 'completed' && t.completedAt)
    .sort((a, b) => cmp(b.completedAt!, a.completedAt!) || cmp(a.id, b.id))
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      completedAt: t.completedAt!,
      ...(t.milestoneId && ms.has(t.milestoneId) ? { milestoneTitle: ms.get(t.milestoneId)! } : {}),
      minutes: minutes[t.id] ?? 0,
      evidence: ws.evidence
        .filter((e) => e.taskId === t.id)
        .sort((a, b) => cmp(a.createdAt, b.createdAt)),
    }));
}

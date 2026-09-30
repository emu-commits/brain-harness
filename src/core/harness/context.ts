import type { ID, ISODate, Intention, Range, Task, Workspace } from '../model/types';
import { depsOfGoal, tasksOfGoal } from '../model/factories';
import { buildGraph } from '../engines/graph';
import { charterLine, lastHandoff } from './hooks';

// Context assembler (SPEC §5.4): each screen gets only what its current step needs.

export interface ExecuteContext {
  charterLine: string | null;
  handoff: string | null;
  task: {
    id: ID;
    title: string;
    kind: Task['kind'];
    definitionOfDone: string;
    estimateMinutes?: Range;
    intention?: Intention;
  };
  /** Immediate predecessors (just resolved). */
  resolved: { id: ID; title: string }[];
  /** What finishing this unlocks: count plus up to 3 titles. */
  unlocks: { count: number; titles: string[] };
  assumption: { id: ID; statement: string } | null;
}

export function assembleContext(
  ws: Workspace,
  screen: 'execute',
  args: { goalId: ID; taskId: ID; today: ISODate },
): ExecuteContext {
  void screen;
  const goal = ws.goals.find((g) => g.id === args.goalId);
  const task = ws.tasks.find((t) => t.id === args.taskId);
  if (!goal || !task) throw new Error('assembleContext: unknown goal or task');
  const tasks = tasksOfGoal(ws, goal.id);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const g = buildGraph(tasks, depsOfGoal(ws, goal.id));
  const succ = (g.succs.get(task.id) ?? [])
    .map((e) => byId.get(e.to)!)
    .filter((t) => t.status !== 'completed');
  const assumption = task.testsAssumptionId
    ? ws.assumptions.find((a) => a.id === task.testsAssumptionId)
    : undefined;
  return {
    charterLine: charterLine(goal),
    handoff: lastHandoff(ws, goal.id)?.note ?? null,
    task: {
      id: task.id,
      title: task.title,
      kind: task.kind,
      definitionOfDone: task.definitionOfDone,
      estimateMinutes: task.estimateMinutes,
      intention: task.intention,
    },
    resolved: (g.preds.get(task.id) ?? []).map((e) => ({
      id: e.from,
      title: byId.get(e.from)!.title,
    })),
    unlocks: { count: succ.length, titles: succ.slice(0, 3).map((t) => t.title) },
    assumption: assumption ? { id: assumption.id, statement: assumption.statement } : null,
  };
}

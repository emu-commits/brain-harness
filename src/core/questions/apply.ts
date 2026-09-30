import type { Clock } from '../util/clock';
import type { IdGen } from '../util/ids';
import type {
  Dependency,
  Goal,
  ID,
  Milestone,
  SuccessCriterion,
  Task,
  Workspace,
} from '../model/types';
import { addDays, isISODate, isYearMonth } from '../util/dates';
import { isCents } from '../util/money';
import {
  capacityOf,
  cmp,
  newGoal,
  newMilestone,
  newTask,
  tasksOfMilestone,
  upsert,
} from '../model/factories';
import type { Result } from '../util/result';
import { err, ok } from '../util/result';
import type { ValidationError } from '../validation/validate';
import { validateWorkspace } from '../validation/validate';
import type { Answer, Question } from './types';

// applyAnswer(model, question, answer) → Result<Model, ValidationError[]> (SPEC §7.1).
// Pure: the new model is validated before it is returned, so it never leaves here invalid.

export interface ApplyContext {
  /** The goal being answered about. Omit only for C1 on a new goal. */
  goalId?: ID;
  ids: IdGen;
  clock: Clock;
}

export interface Applied {
  ws: Workspace;
  goalId: ID;
  /** Ids of objects created by this answer. */
  created: ID[];
}

/** Placeholder target date for a brand-new goal until C3 answers it. */
export const PROVISIONAL_TARGET_DAYS = 365;

const fail = (
  message: string,
  table: keyof Workspace = 'goals',
  id = '',
): Result<Applied, ValidationError[]> => err([{ code: 'badValue', table, id, message }]);

function expect<T extends Answer['type']>(a: Answer, type: T): Extract<Answer, { type: T }> | null {
  return a.type === type ? (a as Extract<Answer, { type: T }>) : null;
}

export function applyAnswer(
  ws: Workspace,
  q: Question,
  answer: Answer,
  ctx: ApplyContext,
): Result<Applied, ValidationError[]> {
  const r = applyRaw(ws, q, answer, ctx);
  if (!r.ok) return r;
  const errors = validateWorkspace(r.value.ws);
  return errors.length ? err(errors) : r;
}

function applyRaw(
  ws: Workspace,
  q: Question,
  answer: Answer,
  ctx: ApplyContext,
): Result<Applied, ValidationError[]> {
  const w = q.writes;
  const { ids, clock } = ctx;

  // C1 on a new goal creates it.
  if (w.kind === 'goal.title' && !ctx.goalId) {
    const a = expect(answer, 'text');
    if (!a || !a.value.trim()) return fail('Write what you’re trying to make happen');
    const g = newGoal(ids, clock, a.value.trim(), addDays(clock.today(), PROVISIONAL_TARGET_DAYS));
    return ok({ ws: { ...ws, goals: [...ws.goals, g] }, goalId: g.id, created: [g.id] });
  }

  const goal = ws.goals.find((g) => g.id === ctx.goalId);
  if (!goal) return fail('Unknown goal');
  const setGoal = (g: Goal): Applied => ({
    ws: { ...ws, goals: upsert(ws.goals, g) },
    goalId: g.id,
    created: [],
  });
  const text = () => {
    const a = expect(answer, 'text');
    return a ? a.value.trim() : null;
  };

  switch (w.kind) {
    case 'goal.title': {
      const t = text();
      if (!t) return fail('Title can’t be empty');
      return ok(setGoal({ ...goal, title: t }));
    }
    case 'goal.successCriterion': {
      const a = expect(answer, 'criterion');
      if (!a || !a.description.trim()) return fail('Describe what would prove it’s done');
      if (a.target !== undefined && !Number.isFinite(a.target))
        return fail('Target must be a number');
      const prev = goal.successCriteria[0];
      const c: SuccessCriterion = {
        id: prev?.id ?? ids.next(),
        description: a.description.trim(),
        metric: a.target === undefined ? '' : a.metric.trim(),
        unit: a.target === undefined ? '' : a.unit.trim(),
        // A criterion without a number is binary: done (1) or not.
        target: a.target ?? 1,
        deadline: prev?.deadline ?? goal.targetDate,
        trackedBy: prev?.trackedBy ?? { kind: 'tasks' },
      };
      return ok(setGoal({ ...goal, successCriteria: [c, ...goal.successCriteria.slice(1)] }));
    }
    case 'goal.targetDate': {
      const a = expect(answer, 'date');
      if (!a || !isISODate(a.value)) return fail('Pick a date');
      const successCriteria = goal.successCriteria.map((c) =>
        c.deadline === goal.targetDate ? { ...c, deadline: a.value } : c,
      );
      return ok(setGoal({ ...goal, targetDate: a.value, successCriteria }));
    }
    case 'goal.charter.why':
    case 'goal.charter.obstacle': {
      const a = answer.type === 'text' ? answer.value.trim() : null;
      if (!a) return fail('Write a few words');
      const field = w.kind === 'goal.charter.why' ? 'why' : 'obstacle';
      return ok(setGoal({ ...goal, charter: { ...goal.charter, [field]: a } }));
    }
    case 'goal.charter.obstaclePlan': {
      const a = expect(answer, 'ifThen');
      if (!a || !a.when.trim() || !a.then.trim()) return fail('Fill in both “when” and “I will”');
      const plan = `When ${stripLead(a.when, 'when')}, I will ${stripLead(a.then, 'i will')}`;
      return ok(setGoal({ ...goal, charter: { ...goal.charter, obstaclePlan: plan } }));
    }
    case 'goal.premortem': {
      const a = expect(answer, 'premortem');
      const reasons = (a?.reasons ?? []).map((r) => r.trim()).filter(Boolean);
      if (!reasons.length) return fail('Write at least one reason');
      const entries = reasons.map((reason) => ({
        id: ids.next(),
        reason,
        response: 'risk' as const,
      }));
      const g = {
        ...goal,
        premortemDoneAt: clock.now(),
        charter: { ...goal.charter, premortem: [...goal.charter.premortem, ...entries] },
      };
      return ok({ ...setGoal(g), created: entries.map((e) => e.id) });
    }
    case 'capacity': {
      const a = expect(answer, 'capacity');
      if (!a) return fail('Enter minutes per day');
      const cap = { ...capacityOf(ws, goal.id), minutesByWeekday: a.minutesByWeekday };
      return ok({
        ws: { ...ws, capacities: upsert(ws.capacities, cap, 'goalId') },
        goalId: goal.id,
        created: [],
      });
    }
    case 'createAccount': {
      const a = expect(answer, 'account');
      if (!a || !a.name.trim()) return fail('Name the account', 'accounts');
      if (!isCents(a.balance)) return fail('Balance must be a whole amount of cents', 'accounts');
      const hasRunway = ws.accounts.some((x) => x.goalId === goal.id && x.isRunwaySource);
      const acct = {
        id: ids.next(),
        goalId: goal.id,
        name: a.name.trim(),
        type: a.accountType,
        balance: a.balance,
        annualRate: { low: 0, base: 0, high: 0 },
        monthlyContribution: 0,
        isRunwaySource: !hasRunway && a.accountType !== 'debt',
      };
      return ok({
        ws: { ...ws, accounts: [...ws.accounts, acct] },
        goalId: goal.id,
        created: [acct.id],
      });
    }
    case 'createMilestone': {
      const t = text();
      if (!t) return fail('Describe the milestone', 'milestones');
      const mine = ws.milestones.filter((m) => m.goalId === goal.id);
      // Backward chaining: the new milestone goes before the named one (or before all of them).
      const before = w.beforeMilestoneId
        ? mine.find((m) => m.id === w.beforeMilestoneId)
        : undefined;
      let order: number;
      let milestones = ws.milestones;
      if (before) {
        order = before.order;
        milestones = ws.milestones.map((m) =>
          m.goalId === goal.id && m.order >= before.order ? { ...m, order: m.order + 1 } : m,
        );
      } else {
        order = mine.length ? Math.min(...mine.map((m) => m.order)) - 1 : 0;
      }
      const m = newMilestone(ids, goal.id, t, order);
      return ok({
        ws: { ...ws, milestones: [...milestones, m] },
        goalId: goal.id,
        created: [m.id],
      });
    }
    case 'createTask': {
      let task: Task;
      const milestoneId = w.milestoneId || firstMilestone(ws, goal.id)?.id;
      if (w.withIntention) {
        const a = expect(answer, 'firstTask');
        if (!a || !a.title.trim()) return fail('Name the action', 'tasks');
        task = newTask(ids, clock, goal.id, a.title.trim(), {
          milestoneId,
          definitionOfDone: a.definitionOfDone.trim(),
          ...(a.when.trim() || a.where.trim()
            ? { intention: { when: a.when.trim(), where: a.where.trim() } }
            : {}),
        });
      } else {
        const t = text();
        if (!t) return fail('Name the task', 'tasks');
        task = newTask(ids, clock, goal.id, t, {
          milestoneId,
          ...(w.testsAssumptionId ? { testsAssumptionId: w.testsAssumptionId } : {}),
        });
      }
      return ok({ ws: { ...ws, tasks: [...ws.tasks, task] }, goalId: goal.id, created: [task.id] });
    }
    case 'createTasks': {
      const a = expect(answer, 'taskList');
      const titles = (a?.titles ?? []).map((t) => t.trim()).filter(Boolean);
      if (!titles.length) return fail('Add at least one task', 'tasks');
      const base = Date.parse(clock.now());
      // Stagger createdAt by a millisecond so list order is the creation order.
      const tasks = titles.map((t, i) =>
        newTask(ids, clock, goal.id, t, {
          milestoneId: w.milestoneId,
          createdAt: new Date(base + i).toISOString(),
        }),
      );
      return ok({
        ws: { ...ws, tasks: [...ws.tasks, ...tasks] },
        goalId: goal.id,
        created: tasks.map((t) => t.id),
      });
    }
    case 'task.definitionOfDone':
    case 'task.estimateMinutes':
    case 'task.referenceMinutes':
    case 'task.split':
    case 'task.dependencies':
      return applyTask(ws, goal, w.kind, w.taskId, answer, ctx);
    case 'revenue.start': {
      const a = expect(answer, 'revenueStart');
      const s = ws.revenueStreams.find((x) => x.id === w.streamId);
      if (!a || !s) return fail('Unknown revenue stream', 'revenueStreams');
      if (!!a.milestoneId === !!a.startMonth)
        return fail('Pick a milestone or a month', 'revenueStreams');
      if (a.startMonth && !isYearMonth(a.startMonth))
        return fail('Month must be YYYY-MM', 'revenueStreams');
      const next = { ...s, startsAfterMilestoneId: a.milestoneId, startMonth: a.startMonth };
      if (!a.milestoneId) delete next.startsAfterMilestoneId;
      if (!a.startMonth) delete next.startMonth;
      return ok({
        ws: { ...ws, revenueStreams: upsert(ws.revenueStreams, next) },
        goalId: goal.id,
        created: [],
      });
    }
  }
}

function applyTask(
  ws: Workspace,
  goal: Goal,
  kind:
    | 'task.definitionOfDone'
    | 'task.estimateMinutes'
    | 'task.referenceMinutes'
    | 'task.split'
    | 'task.dependencies',
  taskId: ID,
  answer: Answer,
  { ids, clock }: ApplyContext,
): Result<Applied, ValidationError[]> {
  const task = ws.tasks.find((t) => t.id === taskId && t.goalId === goal.id);
  if (!task) return fail('Unknown task', 'tasks', taskId);
  const set = (t: Task): Applied => ({
    ws: { ...ws, tasks: upsert(ws.tasks, t) },
    goalId: goal.id,
    created: [],
  });

  switch (kind) {
    case 'task.definitionOfDone': {
      if (answer.type !== 'text' || !answer.value.trim())
        return fail('Describe what done looks like', 'tasks', taskId);
      return ok(set({ ...task, definitionOfDone: answer.value.trim() }));
    }
    case 'task.estimateMinutes': {
      if (answer.type !== 'range')
        return fail('Enter best, likely and worst case', 'tasks', taskId);
      return ok(set({ ...task, estimateMinutes: { ...answer.value } }));
    }
    case 'task.referenceMinutes': {
      if (answer.type !== 'number' || !(answer.value >= 0))
        return fail('Enter minutes', 'tasks', taskId);
      return ok(set({ ...task, referenceMinutes: answer.value }));
    }
    case 'task.dependencies': {
      if (answer.type !== 'multiChoice') return fail('Pick tasks', 'tasks', taskId);
      const existing = new Set(
        ws.dependencies.filter((d) => d.toTaskId === taskId).map((d) => d.fromTaskId),
      );
      const deps: Dependency[] = answer.values
        .filter((from) => !existing.has(from))
        .map((from) => ({ id: ids.next(), fromTaskId: from, toTaskId: taskId, lagDays: 0 }));
      return ok({
        ws: { ...ws, dependencies: [...ws.dependencies, ...deps] },
        goalId: goal.id,
        created: deps.map((d) => d.id),
      });
    }
    case 'task.split': {
      if (answer.type !== 'taskList') return fail('List the pieces', 'tasks', taskId);
      const titles = answer.titles.map((t) => t.trim()).filter(Boolean);
      if (titles.length < 2) return fail('List at least two pieces', 'tasks', taskId);
      const r = splitTask(ws, taskId, titles, ids, clock);
      return ok({ ws: r.ws, goalId: goal.id, created: r.created });
    }
  }
}

/**
 * Replace a task with a chain of smaller tasks. The first piece inherits the original's
 * predecessors and the last piece its successors. The original task is removed.
 */
export function splitTask(
  ws: Workspace,
  taskId: ID,
  titles: string[],
  ids: IdGen,
  clock: Clock,
): { ws: Workspace; created: ID[] } {
  const orig = ws.tasks.find((t) => t.id === taskId)!;
  const base = Date.parse(orig.createdAt);
  const pieces = titles.map((title, i) =>
    newTask(ids, clock, orig.goalId, title, {
      milestoneId: orig.milestoneId,
      kind: orig.kind === 'wait' ? 'work' : orig.kind,
      priority: orig.priority,
      energy: orig.energy,
      category: orig.category,
      earliestStart: orig.earliestStart,
      testsAssumptionId: i === titles.length - 1 ? orig.testsAssumptionId : undefined,
      createdAt: new Date(base + i).toISOString(),
    }),
  );
  for (const p of pieces)
    for (const k of Object.keys(p) as (keyof Task)[]) if (p[k] === undefined) delete p[k];
  const first = pieces[0]!;
  const last = pieces[pieces.length - 1]!;
  const deps: Dependency[] = [];
  for (const d of ws.dependencies) {
    if (d.toTaskId === taskId) deps.push({ ...d, toTaskId: first.id });
    else if (d.fromTaskId === taskId) deps.push({ ...d, fromTaskId: last.id });
    else deps.push(d);
  }
  for (let i = 1; i < pieces.length; i++) {
    deps.push({
      id: ids.next(),
      fromTaskId: pieces[i - 1]!.id,
      toTaskId: pieces[i]!.id,
      lagDays: 0,
    });
  }
  return {
    ws: {
      ...ws,
      tasks: [...ws.tasks.filter((t) => t.id !== taskId), ...pieces],
      dependencies: deps,
    },
    created: pieces.map((p) => p.id),
  };
}

export function firstMilestone(ws: Workspace, goalId: ID): Milestone | undefined {
  return ws.milestones
    .filter((m) => m.goalId === goalId)
    .sort((a, b) => a.order - b.order || cmp(a.id, b.id))[0];
}

/** First task in a milestone by creation order (the one exempt from gap G8). */
export function firstTaskOf(ws: Workspace, milestoneId: ID): Task | undefined {
  return tasksOfMilestone(ws, milestoneId)[0];
}

function stripLead(s: string, lead: string): string {
  const t = s.trim().replace(/[.,]+$/, '');
  return t.toLowerCase().startsWith(lead + ' ') ? t.slice(lead.length + 1) : t;
}

import type { Goal, ID, ISODate, Workspace } from '../model/types';
import {
  capacityOf,
  cmp,
  getSettings,
  milestonesOfGoal,
  tasksOfGoal,
  tasksOfMilestone,
  totalWeeklyMinutes,
} from '../model/factories';
import { diffDays } from '../util/dates';
import { hashValue } from '../util/hash';
import { bindQuestion, promptFor, question } from './bank';
import type { Question } from './types';

// Gap detector (SPEC §7.2): deterministic gaps, each mapped to a question.

export type GapCode =
  'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9' | 'G10' | 'G11' | 'G12';

export const GAP_PRIORITY: Record<GapCode, number> = {
  G1: 1,
  G2: 1,
  G3: 2,
  G4: 2,
  G5: 2,
  G6: 3,
  G7: 3,
  G8: 3,
  G9: 3,
  G10: 3,
  G11: 2,
  G12: 4,
};

export interface Gap {
  /** Stable key: `${code}:${objectId}`. */
  key: string;
  code: GapCode;
  priority: number;
  objectId: ID;
  /** Hash of the object the gap points at; a dismissal holds until this changes. */
  objectHash: string;
  /** Placeholder values for the prompt. */
  params: Record<string, string>;
  /** Position of the object in its natural order, for a stable, readable sort. */
  rank: number;
}

/** Goal is "near" when its target date is within this many days. */
export const NEAR_GOAL_DAYS = 30;

const MONEY_TRACKED = new Set(['netWorth', 'monthlyRevenue', 'accountBalance']);

export function isMeasurable(goal: Goal): boolean {
  return goal.successCriteria.some(
    (c) => c.description.trim() && c.metric.trim() && Number.isFinite(c.target),
  );
}

export function detectGaps(
  ws: Workspace,
  goalId: ID,
  today: ISODate,
  opts: { includeDismissed?: boolean } = {},
): Gap[] {
  const goal = ws.goals.find((g) => g.id === goalId);
  if (!goal) return [];
  const settings = getSettings(ws);
  const out: Gap[] = [];
  const add = (
    code: GapCode,
    objectId: ID,
    object: unknown,
    params: Record<string, string>,
    rank = 0,
  ) =>
    out.push({
      key: `${code}:${objectId}`,
      code,
      priority: GAP_PRIORITY[code],
      objectId,
      objectHash: hashValue(object),
      params,
      rank,
    });

  const milestones = milestonesOfGoal(ws, goalId);
  const tasks = tasksOfGoal(ws, goalId);
  const open = tasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
  const taskRank = new Map(
    [...tasks]
      .sort((a, b) => {
        const ma = milestones.findIndex((m) => m.id === a.milestoneId);
        const mb = milestones.findIndex((m) => m.id === b.milestoneId);
        return (
          (ma < 0 ? 1e9 : ma) - (mb < 0 ? 1e9 : mb) ||
          cmp(a.createdAt, b.createdAt) ||
          cmp(a.id, b.id)
        );
      })
      .map((t, i) => [t.id, i]),
  );

  // G1: no measurable success criterion.
  if (!isMeasurable(goal)) add('G1', goal.id, goal.successCriteria, { goal: goal.title });

  // G2: no weekly capacity.
  const cap = capacityOf(ws, goalId);
  if (totalWeeklyMinutes(cap) === 0) add('G2', goal.id, cap, {});

  // G3: milestone with no tasks.
  milestones.forEach((m, i) => {
    if (!tasks.some((t) => t.milestoneId === m.id && t.status !== 'skipped'))
      add('G3', m.id, m, { milestone: m.title }, i);
  });

  // G4: at most one milestone and the goal isn't near.
  if (milestones.length <= 1 && diffDays(today, goal.targetDate) > NEAR_GOAL_DAYS) {
    const earliest = milestones[0];
    add('G4', earliest?.id ?? goal.id, milestones, { milestone: earliest?.title ?? goal.title });
  }

  for (const t of open) {
    const rank = taskRank.get(t.id) ?? 0;
    const p = { task: t.title };
    // G5: no definition of done.
    if (!t.definitionOfDone.trim()) add('G5', t.id, t, p, rank);
    if (t.kind !== 'wait') {
      // G6: estimate missing, or low = high.
      if (!t.estimateMinutes || t.estimateMinutes.low === t.estimateMinutes.high)
        add('G6', t.id, t, p, rank);
      // G7: too big.
      else if (t.estimateMinutes.base > settings.splitThresholdMinutes) add('G7', t.id, t, p, rank);
    }
    // G8: not first in its milestone and has no dependencies.
    if (t.milestoneId) {
      const first = tasksOfMilestone(ws, t.milestoneId)[0];
      const hasDeps = ws.dependencies.some((d) => d.toTaskId === t.id);
      if (first && first.id !== t.id && !hasDeps) add('G8', t.id, { t, deps: [] }, p, rank);
    }
  }

  // G9: untested assumption with no validating task.
  ws.assumptions
    .filter((a) => a.goalId === goalId)
    .sort((a, b) => cmp(a.id, b.id))
    .forEach((a, i) => {
      if (a.status === 'untested' && !tasks.some((t) => t.testsAssumptionId === a.id)) {
        add('G9', a.id, a, { assumption: a.statement }, i);
      }
    });

  // G10: revenue stream with no start trigger.
  ws.revenueStreams
    .filter((s) => s.goalId === goalId)
    .sort((a, b) => cmp(a.id, b.id))
    .forEach((s, i) => {
      if (!s.startMonth && !s.startsAfterMilestoneId) add('G10', s.id, s, { stream: s.name }, i);
    });

  // G11: a financial goal with no accounts.
  const financial = goal.successCriteria.some((c) => MONEY_TRACKED.has(c.trackedBy.kind));
  if (financial && !ws.accounts.some((a) => a.goalId === goalId))
    add('G11', goal.id, goal.successCriteria, {});

  // G12: premortem never done and ≥ 3 milestones.
  if (!goal.premortemDoneAt && milestones.length >= 3) {
    add(
      'G12',
      goal.id,
      milestones.map((m) => m.id),
      { deadline: goal.targetDate },
    );
  }

  let gaps = out;
  if (!opts.includeDismissed) {
    const dismissed = new Map(ws.gapDismissals.map((d) => [d.gapKey, d.objectHash]));
    gaps = gaps.filter((g) => dismissed.get(g.key) !== g.objectHash);
  }
  if (goal.scaffoldLevel === 3) gaps = gaps.filter((g) => g.priority <= 2);
  const codeNum = (c: GapCode) => Number(c.slice(1));
  return gaps.sort(
    (a, b) =>
      a.priority - b.priority ||
      codeNum(a.code) - codeNum(b.code) ||
      a.rank - b.rank ||
      cmp(a.key, b.key),
  );
}

/** The gaps a Plan session shows: at most maxGapsPerSession. */
export function sessionGaps(ws: Workspace, goalId: ID, today: ISODate): Gap[] {
  return detectGaps(ws, goalId, today).slice(0, getSettings(ws).maxGapsPerSession);
}

/** The question for a gap, with its write target bound to the gap's object. */
export function gapQuestion(gap: Gap): Question {
  return bindQuestion(question(gap.code), gap.objectId);
}

export function gapPrompt(gap: Gap, level: 1 | 2 | 3) {
  return promptFor(question(gap.code), level, gap.params);
}

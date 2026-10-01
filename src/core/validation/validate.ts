import type { Cents, ID, Range, Workspace } from '../model/types';
import { cmp } from '../model/factories';
import { buildGraph, findCycles } from '../engines/graph';
import { isISODate, isYearMonth } from '../util/dates';
import { isCents } from '../util/money';

// Model invariants (SPEC §8.1). Invalid writes are rejected; nothing invalid is persisted.

export type ValidationCode =
  | 'emptyTitle'
  | 'badRange'
  | 'negative'
  | 'notInteger'
  | 'badDate'
  | 'missingRef'
  | 'crossGoalRef'
  | 'selfDependency'
  | 'duplicateDependency'
  | 'cycle'
  | 'runwaySource'
  | 'revenueStart'
  | 'badCapacity'
  | 'badValue'
  | 'duplicateId';

export interface ValidationError {
  code: ValidationCode;
  table: keyof Workspace;
  id: string;
  field?: string;
  message: string;
  /** For cycles: the task ids involved. */
  taskIds?: ID[];
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function isValidRange(
  r: Range | undefined,
  opts: { integer?: boolean; min?: number } = {},
): boolean {
  if (!r) return true;
  const vals = [r.low, r.base, r.high];
  if (!vals.every(isNum)) return false;
  if (opts.integer && !vals.every((v) => Number.isInteger(v))) return false;
  if (opts.min !== undefined && vals.some((v) => v < opts.min!)) return false;
  return r.low <= r.base && r.base <= r.high;
}

export function validateWorkspace(ws: Workspace): ValidationError[] {
  const errors: ValidationError[] = [];
  const push = (e: ValidationError) => errors.push(e);

  // Unique primary keys.
  const uniq = (table: keyof Workspace, key: string) => {
    const seen = new Set<string>();
    for (const row of ws[table] as unknown as Record<string, string>[]) {
      const k = row[key]!;
      if (seen.has(k))
        push({ code: 'duplicateId', table, id: k, message: `Duplicate ${key} in ${table}` });
      seen.add(k);
    }
  };
  uniq('goals', 'id');
  uniq('milestones', 'id');
  uniq('tasks', 'id');
  uniq('dependencies', 'id');
  uniq('capacities', 'goalId');
  uniq('accounts', 'id');

  const goals = new Map(ws.goals.map((g) => [g.id, g]));
  const milestones = new Map(ws.milestones.map((m) => [m.id, m]));
  const tasks = new Map(ws.tasks.map((t) => [t.id, t]));
  const assumptions = new Map(ws.assumptions.map((a) => [a.id, a]));
  const accounts = new Map(ws.accounts.map((a) => [a.id, a]));

  for (const g of ws.goals) {
    if (!g.title.trim())
      push({
        code: 'emptyTitle',
        table: 'goals',
        id: g.id,
        field: 'title',
        message: 'Goal needs a title',
      });
    if (!isISODate(g.targetDate))
      push({
        code: 'badDate',
        table: 'goals',
        id: g.id,
        field: 'targetDate',
        message: 'Goal needs a valid target date',
      });
    if (![1, 2, 3].includes(g.scaffoldLevel))
      push({
        code: 'badValue',
        table: 'goals',
        id: g.id,
        field: 'scaffoldLevel',
        message: 'Scaffold level must be 1, 2 or 3',
      });
    for (const c of g.successCriteria) {
      if (!isNum(c.target))
        push({
          code: 'badValue',
          table: 'goals',
          id: g.id,
          field: 'successCriteria',
          message: 'Success target must be a number',
        });
      if (!isISODate(c.deadline))
        push({
          code: 'badDate',
          table: 'goals',
          id: g.id,
          field: 'successCriteria',
          message: 'Success criterion needs a valid deadline',
        });
      if (c.trackedBy.kind === 'accountBalance' && !accounts.has(c.trackedBy.accountId)) {
        push({
          code: 'missingRef',
          table: 'goals',
          id: g.id,
          field: 'successCriteria',
          message: 'Tracked account does not exist',
        });
      }
    }
    for (const cm of g.charter.commitments) {
      if (cm.rule?.kind === 'maxWeeklyMinutes' && !(isNum(cm.rule.value) && cm.rule.value >= 0)) {
        push({
          code: 'negative',
          table: 'goals',
          id: g.id,
          field: 'commitments',
          message: 'Weekly limit must be ≥ 0',
        });
      }
      if (cm.rule?.kind === 'maxSpendBeforeMilestone') {
        if (!isCents(cm.rule.cents) || cm.rule.cents < 0)
          push({
            code: 'notInteger',
            table: 'goals',
            id: g.id,
            field: 'commitments',
            message: 'Spending limit must be whole cents ≥ 0',
          });
        if (!milestones.has(cm.rule.milestoneId))
          push({
            code: 'missingRef',
            table: 'goals',
            id: g.id,
            field: 'commitments',
            message: 'Commitment refers to a missing milestone',
          });
      }
    }
  }

  for (const m of ws.milestones) {
    if (!m.title.trim())
      push({
        code: 'emptyTitle',
        table: 'milestones',
        id: m.id,
        field: 'title',
        message: 'Milestone needs a title',
      });
    if (!goals.has(m.goalId))
      push({
        code: 'missingRef',
        table: 'milestones',
        id: m.id,
        field: 'goalId',
        message: 'Milestone refers to a missing goal',
      });
    if (!isNum(m.order))
      push({
        code: 'badValue',
        table: 'milestones',
        id: m.id,
        field: 'order',
        message: 'Milestone order must be a number',
      });
  }

  for (const t of ws.tasks) {
    const e = (code: ValidationCode, field: string, message: string) =>
      push({ code, table: 'tasks', id: t.id, field, message });
    if (!t.title.trim()) e('emptyTitle', 'title', 'Task needs a title');
    if (!goals.has(t.goalId)) e('missingRef', 'goalId', 'Task refers to a missing goal');
    if (t.milestoneId !== undefined) {
      const m = milestones.get(t.milestoneId);
      if (!m) e('missingRef', 'milestoneId', 'Task refers to a missing milestone');
      else if (m.goalId !== t.goalId)
        e('crossGoalRef', 'milestoneId', 'Task and milestone belong to different goals');
    }
    if (!isValidRange(t.estimateMinutes, { min: 0 }))
      e('badRange', 'estimateMinutes', 'Estimate must be best ≤ likely ≤ worst, all ≥ 0');
    if (!isValidRange(t.waitDays, { min: 0 }))
      e('badRange', 'waitDays', 'Wait must be best ≤ likely ≤ worst, all ≥ 0');
    if (!isValidRange(t.cost, { min: 0, integer: true }))
      e('badRange', 'cost', 'Cost must be whole cents, best ≤ likely ≤ worst, all ≥ 0');
    if (t.referenceMinutes !== undefined && !(isNum(t.referenceMinutes) && t.referenceMinutes >= 0))
      e('negative', 'referenceMinutes', 'Reference time must be ≥ 0');
    if (t.earliestStart !== undefined && !isISODate(t.earliestStart))
      e('badDate', 'earliestStart', 'Earliest start must be a valid date');
    if (t.targetDate !== undefined && !isISODate(t.targetDate))
      e('badDate', 'targetDate', 'Target date must be a valid date');
    if (t.testsAssumptionId !== undefined && !assumptions.has(t.testsAssumptionId))
      e('missingRef', 'testsAssumptionId', 'Task tests a missing assumption');
    if (![1, 2, 3].includes(t.priority)) e('badValue', 'priority', 'Priority must be 1, 2 or 3');
  }

  const depKeys = new Set<string>();
  for (const d of ws.dependencies) {
    const e = (code: ValidationCode, message: string) =>
      push({ code, table: 'dependencies', id: d.id, message });
    const from = tasks.get(d.fromTaskId);
    const to = tasks.get(d.toTaskId);
    if (!from || !to) e('missingRef', 'Dependency refers to a missing task');
    else if (from.goalId !== to.goalId) e('crossGoalRef', 'Dependency crosses goals');
    if (d.fromTaskId === d.toTaskId) e('selfDependency', 'A task cannot depend on itself');
    if (!(isNum(d.lagDays) && d.lagDays >= 0)) e('negative', 'Lag must be ≥ 0 days');
    const k = `${d.fromTaskId}>${d.toTaskId}`;
    if (depKeys.has(k)) e('duplicateDependency', 'Duplicate dependency');
    depKeys.add(k);
  }
  const g = buildGraph(
    ws.tasks.map((t) => ({ id: t.id })),
    ws.dependencies,
  );
  for (const comp of findCycles(g)) {
    const names = comp.map((id) => `"${tasks.get(id)?.title ?? id}"`).join(' → ');
    push({
      code: 'cycle',
      table: 'dependencies',
      id: comp[0]!,
      taskIds: comp,
      message: `These tasks depend on each other in a loop: ${names}`,
    });
  }

  for (const a of ws.assumptions) {
    if (!a.statement.trim())
      push({
        code: 'emptyTitle',
        table: 'assumptions',
        id: a.id,
        field: 'statement',
        message: 'Assumption needs a statement',
      });
    if (!goals.has(a.goalId))
      push({
        code: 'missingRef',
        table: 'assumptions',
        id: a.id,
        field: 'goalId',
        message: 'Assumption refers to a missing goal',
      });
    if (!isValidRange(a.value))
      push({
        code: 'badRange',
        table: 'assumptions',
        id: a.id,
        field: 'value',
        message: 'Assumption range must be low ≤ base ≤ high',
      });
  }

  for (const c of ws.capacities) {
    if (
      c.minutesByWeekday.length !== 7 ||
      !c.minutesByWeekday.every((m) => isNum(m) && m >= 0 && m <= 1440)
    ) {
      push({
        code: 'badCapacity',
        table: 'capacities',
        id: c.goalId,
        message: 'Weekly capacity needs 7 values between 0 and 1440 minutes',
      });
    }
  }

  // Accounts: integer money, valid rate ranges, exactly one runway source per goal with accounts.
  const byGoal = new Map<ID, number>();
  const goalsWithAccounts = new Set<ID>();
  for (const a of ws.accounts) {
    const e = (code: ValidationCode, field: string, message: string) =>
      push({ code, table: 'accounts', id: a.id, field, message });
    if (!a.name.trim()) e('emptyTitle', 'name', 'Account needs a name');
    if (!goals.has(a.goalId)) e('missingRef', 'goalId', 'Account refers to a missing goal');
    if (!isCents(a.balance)) e('notInteger', 'balance', 'Balance must be whole cents');
    if (!isCents(a.monthlyContribution) || a.monthlyContribution < 0)
      e('notInteger', 'monthlyContribution', 'Monthly amount must be whole cents ≥ 0');
    if (!isValidRange(a.annualRate, { min: -1 }))
      e('badRange', 'annualRate', 'Rate range must be low ≤ base ≤ high');
    goalsWithAccounts.add(a.goalId);
    if (a.isRunwaySource) {
      byGoal.set(a.goalId, (byGoal.get(a.goalId) ?? 0) + 1);
      if (a.type === 'debt')
        e('runwaySource', 'isRunwaySource', 'A debt account cannot be the runway source');
    }
  }
  for (const gid of [...goalsWithAccounts].sort(cmp)) {
    if ((byGoal.get(gid) ?? 0) !== 1) {
      push({
        code: 'runwaySource',
        table: 'accounts',
        id: gid,
        field: 'isRunwaySource',
        message: 'Exactly one account must be the runway source',
      });
    }
  }

  for (const f of ws.cashFlows) {
    const e = (code: ValidationCode, field: string, message: string) =>
      push({ code, table: 'cashFlows', id: f.id, field, message });
    if (!f.name.trim()) e('emptyTitle', 'name', 'Cash flow needs a name');
    if (!isCents(f.amount)) e('notInteger', 'amount', 'Amount must be whole cents');
    if (!accounts.has(f.accountId))
      e('missingRef', 'accountId', 'Cash flow refers to a missing account');
    if (!isYearMonth(f.startMonth)) e('badDate', 'startMonth', 'Start month must be YYYY-MM');
    if (f.endMonth !== undefined && (!isYearMonth(f.endMonth) || f.endMonth < f.startMonth))
      e('badDate', 'endMonth', 'End month must be YYYY-MM, not before start');
  }

  for (const r of ws.revenueStreams) {
    const e = (code: ValidationCode, field: string, message: string) =>
      push({ code, table: 'revenueStreams', id: r.id, field, message });
    if (!r.name.trim()) e('emptyTitle', 'name', 'Revenue stream needs a name');
    if (!accounts.has(r.accountId))
      e('missingRef', 'accountId', 'Revenue stream refers to a missing account');
    const hasM = r.startsAfterMilestoneId !== undefined;
    const hasS = r.startMonth !== undefined;
    // At most one start. None is allowed (the stream is inactive) so gap G10 can ask for it.
    if (hasM && hasS)
      e(
        'revenueStart',
        'startMonth',
        'Revenue stream needs one start: a milestone or a month, not both',
      );
    if (hasM && !milestones.has(r.startsAfterMilestoneId!))
      e('missingRef', 'startsAfterMilestoneId', 'Revenue stream refers to a missing milestone');
    if (hasS && !isYearMonth(r.startMonth))
      e('badDate', 'startMonth', 'Start month must be YYYY-MM');
    if (!isValidRange(r.rampMonths, { min: 0 }))
      e('badRange', 'rampMonths', 'Ramp months must be low ≤ base ≤ high, ≥ 0');
    if (!isValidRange(r.targetMonthly, { min: 0, integer: true }))
      e('badRange', 'targetMonthly', 'Monthly target must be whole cents, low ≤ base ≤ high');
  }

  for (const x of ws.executionRecords) {
    if (!(isNum(x.minutes) && x.minutes >= 0))
      push({
        code: 'negative',
        table: 'executionRecords',
        id: x.id,
        field: 'minutes',
        message: 'Minutes must be ≥ 0',
      });
    if (x.cost !== undefined && !(isCents(x.cost) && (x.cost as Cents) >= 0))
      push({
        code: 'notInteger',
        table: 'executionRecords',
        id: x.id,
        field: 'cost',
        message: 'Cost must be whole cents ≥ 0',
      });
    if (!tasks.has(x.taskId))
      push({
        code: 'missingRef',
        table: 'executionRecords',
        id: x.id,
        field: 'taskId',
        message: 'Record refers to a missing task',
      });
  }
  for (const x of ws.evidence) {
    if (!tasks.has(x.taskId))
      push({
        code: 'missingRef',
        table: 'evidence',
        id: x.id,
        field: 'taskId',
        message: 'Evidence refers to a missing task',
      });
  }
  for (const s of ws.scenarioSettings) {
    if (!(isNum(s.inflationAnnual) && s.inflationAnnual > -1))
      push({
        code: 'badValue',
        table: 'scenarioSettings',
        id: s.goalId,
        message: 'Inflation must be a number above −100%',
      });
    if (!(Number.isInteger(s.horizonMonths) && s.horizonMonths >= 1 && s.horizonMonths <= 600))
      push({
        code: 'badValue',
        table: 'scenarioSettings',
        id: s.goalId,
        message: 'Horizon must be 1–600 months',
      });
  }

  for (const c of ws.checkins) {
    if (!goals.has(c.goalId))
      push({
        code: 'missingRef',
        table: 'checkins',
        id: c.id,
        field: 'goalId',
        message: 'Check-in refers to a missing goal',
      });
    if (!isISODate(c.day))
      push({
        code: 'badDate',
        table: 'checkins',
        id: c.id,
        field: 'day',
        message: 'Check-in needs a valid day',
      });
  }

  return errors;
}

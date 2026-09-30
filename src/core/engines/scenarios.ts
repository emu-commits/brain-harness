import type {
  Capacity,
  CashFlow,
  Cents,
  Dependency,
  FinancialAccount,
  ID,
  ISODate,
  Milestone,
  Pick,
  RevenueStream,
  ScenarioId,
  ScenarioMultipliers,
  ScenarioSettings,
  SuccessCriterion,
  Task,
  Workspace,
} from '../model/types';
import { SCENARIOS } from '../model/types';
import {
  capacityOf,
  cmp,
  depsOfGoal,
  getSettings,
  loggedMinutesByTask,
  milestonesOfGoal,
  scenarioSettingsOf,
  tasksOfGoal,
} from '../model/factories';
import { monthEnd, yearMonth } from '../util/dates';
import { roundCents } from '../util/money';
import type { FinanceOutput, FinancePicks } from './finance';
import { projectFinances } from './finance';
import type { Schedule, ScheduleError } from './scheduler';
import { schedule } from './scheduler';
import { acceptedCalibration } from './calibration';

// Scenarios come straight from the user's own ranges (SPEC §9.5).

export const ENGINE_VERSION = '1.0.0';

export interface ScenarioPicks extends FinancePicks {
  duration: Pick;
  wait: Pick;
}

export const SCENARIO_PICKS: Record<ScenarioId, ScenarioPicks> = {
  conservative: {
    duration: 'high',
    wait: 'high',
    cost: 'high',
    revenue: 'low',
    ramp: 'high',
    assetRate: 'low',
    debtRate: 'high',
  },
  base: {
    duration: 'base',
    wait: 'base',
    cost: 'base',
    revenue: 'base',
    ramp: 'base',
    assetRate: 'base',
    debtRate: 'base',
  },
  optimistic: {
    duration: 'low',
    wait: 'low',
    cost: 'low',
    revenue: 'high',
    ramp: 'low',
    assetRate: 'high',
    debtRate: 'low',
  },
};

/** Everything a forecast depends on. Self-contained so snapshots can be diffed and replayed. */
export interface ForecastInputs {
  today: ISODate;
  goal: { id: ID; targetDate: ISODate; successCriteria: SuccessCriterion[] };
  milestones: Pick_<Milestone, 'id' | 'title' | 'order'>[];
  tasks: Task[];
  dependencies: Dependency[];
  capacity: Capacity;
  loggedMinutes: Record<ID, number>;
  calibration: Record<string, number>;
  accounts: FinancialAccount[];
  cashFlows: CashFlow[];
  revenueStreams: RevenueStream[];
  scenario: ScenarioSettings;
  blockedAssumeDays: number;
}
type Pick_<T, K extends keyof T> = { [P in K]: T[P] };

export interface Trace {
  label: string;
  formula: string;
  inputs: ID[];
  picks: Record<string, string>;
  multipliers: Record<string, number>;
  notes: string[];
}

export interface ForecastOutput {
  scenario: ScenarioId;
  picks: ScenarioPicks;
  multipliers: ScenarioMultipliers;
  schedule: Schedule | null;
  scheduleError: ScheduleError | null;
  finance: FinanceOutput | null;
  /** Modeled completion date for the primary success criterion, or null. */
  goalCompletion: ISODate | null;
  goalCompletionNote: string;
  netWorthAtTarget: Cents | null;
  totalCost: Cents;
  runwayExhaustedMonth: string | null;
  traces: Record<string, Trace>;
}

export type Forecast = Record<ScenarioId, ForecastOutput>;

export function buildForecastInputs(ws: Workspace, goalId: ID, today: ISODate): ForecastInputs {
  const goal = ws.goals.find((g) => g.id === goalId);
  if (!goal) throw new Error(`buildForecastInputs: unknown goal ${goalId}`);
  const tasks = tasksOfGoal(ws, goalId).sort((a, b) => cmp(a.id, b.id));
  const taskIds = new Set(tasks.map((t) => t.id));
  const logged = loggedMinutesByTask(ws);
  const loggedMinutes: Record<ID, number> = {};
  for (const id of [...taskIds].sort(cmp)) if (logged[id]) loggedMinutes[id] = logged[id]!;
  return {
    today,
    goal: { id: goal.id, targetDate: goal.targetDate, successCriteria: goal.successCriteria },
    milestones: milestonesOfGoal(ws, goalId).map(({ id, title, order }) => ({ id, title, order })),
    tasks,
    dependencies: depsOfGoal(ws, goalId).sort((a, b) => cmp(a.id, b.id)),
    capacity: capacityOf(ws, goalId),
    loggedMinutes,
    calibration: acceptedCalibration(ws.calibrationDecisions.filter((d) => d.goalId === goalId)),
    accounts: ws.accounts.filter((a) => a.goalId === goalId).sort((a, b) => cmp(a.id, b.id)),
    cashFlows: ws.cashFlows.filter((c) => c.goalId === goalId).sort((a, b) => cmp(a.id, b.id)),
    revenueStreams: ws.revenueStreams
      .filter((r) => r.goalId === goalId)
      .sort((a, b) => cmp(a.id, b.id)),
    scenario: scenarioSettingsOf(ws, goalId),
    blockedAssumeDays: getSettings(ws).blockedAssumeDays,
  };
}

export function runScenario(inputs: ForecastInputs, scenario: ScenarioId): ForecastOutput {
  const picks = SCENARIO_PICKS[scenario];
  const mult = inputs.scenario.multipliers[scenario];
  const horizonDays = inputs.scenario.horizonMonths * 31;
  const traces: Record<string, Trace> = {};
  const multipliers = { ...mult };

  // Waits use the wait pick; work uses the duration pick. They are the same per scenario today,
  // so a single scheduler run with picks.duration is exact.
  const sched = schedule({
    today: inputs.today,
    tasks: inputs.tasks,
    dependencies: inputs.dependencies,
    milestoneIds: inputs.milestones.map((m) => m.id),
    minutesByWeekday: inputs.capacity.minutesByWeekday,
    loggedMinutes: inputs.loggedMinutes,
    pick: picks.duration,
    durationMult: mult.duration,
    capacityMult: mult.capacity,
    calibration: inputs.calibration,
    blockedAssumeDays: inputs.blockedAssumeDays,
    horizonDays,
  });
  const s = sched.ok ? sched.value : null;

  const openTaskIds = inputs.tasks
    .filter((t) => t.status !== 'completed' && t.status !== 'skipped')
    .map((t) => t.id);

  if (s) {
    traces.completion = {
      label: 'Modeled task completion',
      formula:
        'Day-by-day schedule: remaining = max(estimate[pick] × durationMult × calibration − logged, 0); each day consumes weekday capacity × capacityMult',
      inputs: [...openTaskIds, `capacity:${inputs.capacity.goalId}`],
      picks: { estimate: picks.duration, wait: picks.wait },
      multipliers: { duration: mult.duration, capacity: mult.capacity },
      notes: [
        `Average capacity ${s.trace.averageDailyMinutes} min/day`,
        ...Object.entries(inputs.calibration).map(
          ([c, m]) => `Accepted calibration ${c === '*' ? 'all tasks' : c}: ×${m}`,
        ),
        ...s.trace.notes,
      ],
    };
    for (const m of inputs.milestones) {
      traces[`milestone:${m.id}`] = {
        label: `Milestone "${m.title}"`,
        formula: 'Latest scheduled finish of the milestone’s tasks',
        inputs: inputs.tasks.filter((t) => t.milestoneId === m.id).map((t) => t.id),
        picks: { estimate: picks.duration },
        multipliers: { duration: mult.duration, capacity: mult.capacity },
        notes: [],
      };
    }
  }

  const hasMoney =
    inputs.accounts.length > 0 || inputs.revenueStreams.length > 0 || inputs.cashFlows.length > 0;
  const taskCosts = s
    ? inputs.tasks
        .filter(
          (t) => t.cost && t.status !== 'completed' && t.status !== 'skipped' && s.tasks[t.id],
        )
        .map((t) => ({ taskId: t.id, finish: s.tasks[t.id]!.finish, cost: t.cost! }))
    : [];
  const finance = hasMoney
    ? projectFinances({
        startMonth: yearMonth(inputs.today),
        horizonMonths: inputs.scenario.horizonMonths,
        picks,
        costMult: mult.cost,
        revenueMult: mult.revenue,
        inflationAnnual: inputs.scenario.inflationAnnual,
        accounts: inputs.accounts,
        cashFlows: inputs.cashFlows,
        revenueStreams: inputs.revenueStreams,
        taskCosts,
        milestoneDates: s?.milestones ?? {},
      })
    : null;

  const totalCost = finance
    ? finance.totalGoalCost
    : taskCosts.reduce((a, t) => a + roundCents(t.cost[picks.cost] * mult.cost), 0);
  traces.totalCost = {
    label: 'Remaining goal cost',
    formula: 'Σ cost[pick] × costMult over unfinished tasks',
    inputs: taskCosts.map((t) => t.taskId),
    picks: { cost: picks.cost },
    multipliers: { cost: mult.cost },
    notes: [],
  };

  // Goal completion by the primary success criterion.
  const crit = inputs.goal.successCriteria[0];
  const tracked = crit?.trackedBy ?? { kind: 'tasks' as const };
  let goalCompletion: ISODate | null = null;
  let goalCompletionNote = '';
  const firstMonth = (pred: (row: FinanceOutput['months'][number]) => boolean) => {
    const row = finance?.months.find(pred);
    return row ? monthEnd(row.month) : null;
  };
  switch (tracked.kind) {
    case 'tasks':
      goalCompletion = s?.completion ?? null;
      goalCompletionNote = s
        ? s.completion
          ? 'When every milestone’s tasks are scheduled to finish'
          : 'No milestones with tasks yet'
        : 'No schedule';
      break;
    case 'netWorth':
      goalCompletion = firstMonth((r) => r.netWorth >= crit!.target);
      goalCompletionNote = 'First month modeled net worth reaches the target';
      break;
    case 'monthlyRevenue':
      goalCompletion = firstMonth((r) => r.revenue >= crit!.target);
      goalCompletionNote = 'First month modeled revenue reaches the target';
      break;
    case 'accountBalance':
      goalCompletion = firstMonth(
        (r) => (r.balances[tracked.accountId] ?? -Infinity) >= crit!.target,
      );
      goalCompletionNote = 'First month the tracked account reaches the target';
      break;
    case 'manual':
      goalCompletionNote = 'Tracked manually; no computed date';
      break;
  }
  if (tracked.kind !== 'tasks' && tracked.kind !== 'manual' && !goalCompletion) {
    goalCompletionNote = 'Not reached within the horizon';
  }
  traces.goalCompletion = {
    label: 'Modeled goal completion',
    formula: goalCompletionNote,
    inputs: crit ? [crit.id] : [],
    picks: { ...picks },
    multipliers,
    notes: traces.completion?.notes ?? [],
  };

  let netWorthAtTarget: Cents | null = null;
  if (finance) {
    const tm = yearMonth(inputs.goal.targetDate);
    const row = finance.months.find((r) => r.month === tm);
    netWorthAtTarget = row ? row.netWorth : null;
    traces.netWorthAtTarget = {
      label: 'Modeled net worth at target date',
      formula:
        'Monthly: growth = round(balance × ((1+rate)^(1/12) − 1)); then contributions/payments, cash flows, goal costs, revenue',
      inputs: inputs.accounts.map((a) => a.id),
      picks: {
        assetRate: picks.assetRate,
        debtRate: picks.debtRate,
        cost: picks.cost,
        revenue: picks.revenue,
      },
      multipliers: { cost: mult.cost, revenue: mult.revenue },
      notes: [
        `Inflation ${inputs.scenario.inflationAnnual * 100}%/yr applied to inflation-adjusted flows`,
      ],
    };
    traces.runway = {
      label: 'Runway',
      formula: 'First month the runway account balance falls below zero',
      inputs: inputs.accounts.filter((a) => a.isRunwaySource).map((a) => a.id),
      picks: { cost: picks.cost, revenue: picks.revenue, ramp: picks.ramp },
      multipliers: { cost: mult.cost, revenue: mult.revenue },
      notes: [],
    };
  }

  return {
    scenario,
    picks,
    multipliers,
    schedule: s,
    scheduleError: sched.ok ? null : sched.error,
    finance,
    goalCompletion,
    goalCompletionNote,
    netWorthAtTarget,
    totalCost,
    runwayExhaustedMonth: finance?.runwayExhaustedMonth ?? null,
    traces,
  };
}

export function runForecast(inputs: ForecastInputs): Forecast {
  const out = {} as Forecast;
  for (const sc of SCENARIOS) out[sc] = runScenario(inputs, sc);
  return out;
}

import type { Clock } from '../core/util/clock';
import type { IdGen } from '../core/util/ids';
import type {
  Dependency,
  ExecutionRecord,
  Range,
  Session,
  Task,
  Workspace,
} from '../core/model/types';
import { defaultScenarioSettings, newGoal, newMilestone, newTask } from '../core/model/factories';
import { addDays } from '../core/util/dates';

// Fictional sample goal, clearly labeled and removable in one tap. Never mixed with real data:
// everything hangs off a goal flagged isDemo.

const r = (low: number, base: number, high: number): Range => ({ low, base, high });

export function buildDemo(
  ws: Workspace,
  ids: IdGen,
  clock: Clock,
): { ws: Workspace; goalId: string } {
  const today = clock.today();
  const ago = (days: number, hour = 10) =>
    `${addDays(today, -days)}T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const goal = newGoal(
    ids,
    clock,
    'Run a weekend sourdough stall at the farmers’ market',
    addDays(today, 240),
  );
  goal.isDemo = true;
  goal.createdAt = ago(20);
  goal.charter.why = 'I want the bread I bake to feed more than my own kitchen.';
  goal.charter.obstacle = 'I keep tweaking recipes instead of shipping.';
  goal.charter.obstaclePlan =
    'When I catch myself re-testing a recipe that’s already good, I will write the change down and bake the standard version.';
  goal.successCriteria = [
    {
      id: ids.next(),
      description: 'Three Saturdays in a row where every loaf sells',
      metric: 'sell-out Saturdays in a row',
      unit: 'Saturdays',
      target: 3,
      deadline: goal.targetDate,
      trackedBy: { kind: 'tasks' },
    },
  ];
  const [m0, m1, m2, m3] = [
    'Recipes are repeatable at 20 loaves',
    'The stall is legal and equipped',
    'A first market day is booked',
    'Three sell-out Saturdays',
  ].map((t, i) => newMilestone(ids, goal.id, t, i)) as [
    ReturnType<typeof newMilestone>,
    ReturnType<typeof newMilestone>,
    ReturnType<typeof newMilestone>,
    ReturnType<typeof newMilestone>,
  ];
  m0.definitionOfDone = 'Two 20-loaf bakes in a row within 5% of target weight';

  const assumption = {
    id: ids.next(),
    goalId: goal.id,
    statement: 'People will pay $9 for a loaf',
    confidence: 'low' as const,
    status: 'untested' as const,
    history: [{ at: ago(20), status: 'untested' as const }],
  };

  let n = 0;
  const T = (title: string, extra: Partial<Task>) =>
    newTask(ids, clock, goal.id, title, {
      createdAt: `${addDays(today, -20)}T08:00:${String(n++).padStart(2, '0')}.000Z`,
      ...extra,
    });
  const t1 = T('Bake three test batches of the country loaf', {
    milestoneId: m0.id,
    estimateMinutes: r(240, 360, 480),
    category: 'baking',
    definitionOfDone: 'Three batches baked and crumb photographed',
    status: 'completed',
    completedAt: ago(12),
  });
  const t2 = T('Write the standard recipe card', {
    milestoneId: m0.id,
    estimateMinutes: r(30, 45, 90),
    category: 'writing',
    energy: 'shallow',
    definitionOfDone: 'Card printed and taped inside the cupboard',
    status: 'completed',
    completedAt: ago(9),
  });
  const t3 = T('Scale the recipe to 20 loaves', {
    milestoneId: m0.id,
    estimateMinutes: r(180, 300, 480),
    category: 'baking',
    definitionOfDone: 'Two 20-loaf bakes within 5% of target weight',
    status: 'inProgress',
    intention: { when: 'Saturday 7am', where: 'Kitchen' },
  });
  const t4 = T('Apply for the cottage food permit', {
    milestoneId: m1.id,
    estimateMinutes: r(45, 60, 120),
    category: 'admin',
    energy: 'shallow',
    definitionOfDone: 'Application submitted, confirmation email saved',
    priority: 1,
  });
  const t5 = T('Permit approval', {
    milestoneId: m1.id,
    kind: 'wait',
    waitDays: r(10, 21, 45),
    definitionOfDone: 'Permit number received',
  });
  const t6 = T('Buy a tent, table and scale', {
    milestoneId: m1.id,
    estimateMinutes: r(60, 90, 180),
    category: 'errands',
    energy: 'shallow',
    cost: r(25000, 32000, 45000),
    definitionOfDone: 'All three in the garage',
  });
  const t7 = T('Decide the price per loaf', {
    milestoneId: m1.id,
    kind: 'decision',
    estimateMinutes: r(30, 60, 120),
    definitionOfDone: 'Price written on the recipe card',
    testsAssumptionId: assumption.id,
  });
  const t8 = T('Email the market manager with photos', {
    milestoneId: m2.id,
    estimateMinutes: r(20, 30, 60),
    category: 'writing',
    energy: 'shallow',
    definitionOfDone: 'Email sent with permit number and 3 photos',
  });
  const t9 = T('Market manager replies', {
    milestoneId: m2.id,
    kind: 'wait',
    waitDays: r(3, 7, 14),
    definitionOfDone: 'A date is confirmed',
  });
  const t10 = T('First market Saturday', {
    milestoneId: m3.id,
    estimateMinutes: r(300, 360, 480),
    category: 'market',
    definitionOfDone: 'Stall ran from open to close; sales notes written',
  });
  const t11 = T('Adjust quantities from sales notes', {
    milestoneId: m3.id,
    estimateMinutes: r(30, 60, 90),
    category: 'writing',
    energy: 'shallow',
    definitionOfDone: 'Next Saturday’s bake list written',
  });
  const tasks = [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11];
  const dep = (a: Task, b: Task, lagDays = 0): Dependency => ({
    id: ids.next(),
    fromTaskId: a.id,
    toTaskId: b.id,
    lagDays,
  });
  const dependencies = [
    dep(t1, t3),
    dep(t2, t3),
    dep(t4, t5),
    dep(t3, t7),
    dep(t5, t8),
    dep(t7, t8),
    dep(t8, t9),
    dep(t9, t10, 2),
    dep(t6, t10),
    dep(t10, t11),
  ];

  const s1: Session = {
    id: ids.next(),
    goalId: goal.id,
    mode: 'plan',
    startedAt: ago(20, 19),
    endedAt: ago(20, 20),
    gapStats: { shown: 5, resolved: 4, stuckTaps: 1 },
  };
  const s2: Session = {
    id: ids.next(),
    goalId: goal.id,
    mode: 'execute',
    startedAt: ago(12, 7),
    endedAt: ago(12, 15),
    handoffNote: 'Batch three was the best. Next: write it down before I forget the hydration.',
  };
  const s3: Session = {
    id: ids.next(),
    goalId: goal.id,
    mode: 'execute',
    startedAt: ago(9, 20),
    endedAt: ago(9, 21),
    handoffNote: 'Card written. Next: first 20-loaf bake on Saturday.',
  };
  const s4: Session = {
    id: ids.next(),
    goalId: goal.id,
    mode: 'execute',
    startedAt: ago(1, 7),
    endedAt: ago(1, 10),
    handoffNote: 'Stopped after the first 20-loaf bake; next: log oven timings on the recipe card.',
  };
  const rec = (task: Task, s: Session, minutes: number, predicted?: number): ExecutionRecord => ({
    id: ids.next(),
    taskId: task.id,
    sessionId: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt!,
    minutes,
    ...(predicted ? { predictedMinutes: predicted } : {}),
  });

  const runway = {
    id: ids.next(),
    goalId: goal.id,
    name: 'Stall fund',
    type: 'cash' as const,
    balance: 60000,
    annualRate: r(0, 0, 0),
    monthlyContribution: 10000,
    isRunwaySource: true,
  };
  const next: Workspace = {
    ...ws,
    goals: [...ws.goals, goal],
    milestones: [...ws.milestones, m0, m1, m2, m3],
    tasks: [...ws.tasks, ...tasks],
    dependencies: [...ws.dependencies, ...dependencies],
    assumptions: [...ws.assumptions, assumption],
    capacities: [
      ...ws.capacities,
      {
        goalId: goal.id,
        minutesByWeekday: [180, 0, 60, 0, 60, 0, 240],
        peakWindows: [
          { weekday: 6, start: '07:00', end: '11:00' },
          { weekday: 0, start: '08:00', end: '11:00' },
        ],
      },
    ],
    sessions: [...ws.sessions, s1, s2, s3, s4],
    executionRecords: [
      ...ws.executionRecords,
      rec(t1, s2, 420, 360),
      rec(t2, s3, 60, 45),
      rec(t3, s4, 150, 150),
    ],
    evidence: [
      ...ws.evidence,
      {
        id: ids.next(),
        taskId: t1.id,
        kind: 'note',
        text: 'Batch 3: 78% hydration, 45 min bake. Best crumb.',
        createdAt: ago(12, 15),
      },
    ],
    memory: [
      ...ws.memory,
      {
        id: ids.next(),
        goalId: goal.id,
        kind: 'decision',
        text: 'One loaf style only for the first month.',
        createdAt: ago(20, 20),
        sessionId: s1.id,
      },
    ],
    accounts: [...ws.accounts, runway],
    revenueStreams: [
      ...ws.revenueStreams,
      {
        id: ids.next(),
        goalId: goal.id,
        name: 'Saturday sales',
        accountId: runway.id,
        startsAfterMilestoneId: m2.id,
        rampMonths: r(2, 3, 5),
        targetMonthly: r(40000, 80000, 120000),
      },
    ],
    scenarioSettings: [...ws.scenarioSettings, defaultScenarioSettings(goal.id)],
  };
  return { ws: next, goalId: goal.id };
}

/** Remove a goal and everything that hangs off it. */
export function removeGoal(ws: Workspace, goalId: string): Workspace {
  const taskIds = new Set(ws.tasks.filter((t) => t.goalId === goalId).map((t) => t.id));
  const accountIds = new Set(ws.accounts.filter((a) => a.goalId === goalId).map((a) => a.id));
  return {
    ...ws,
    goals: ws.goals.filter((g) => g.id !== goalId),
    milestones: ws.milestones.filter((m) => m.goalId !== goalId),
    tasks: ws.tasks.filter((t) => t.goalId !== goalId),
    dependencies: ws.dependencies.filter(
      (d) => !taskIds.has(d.fromTaskId) && !taskIds.has(d.toTaskId),
    ),
    assumptions: ws.assumptions.filter((a) => a.goalId !== goalId),
    capacities: ws.capacities.filter((c) => c.goalId !== goalId),
    sessions: ws.sessions.filter((s) => s.goalId !== goalId),
    executionRecords: ws.executionRecords.filter((r) => !taskIds.has(r.taskId)),
    evidence: ws.evidence.filter((e) => !taskIds.has(e.taskId)),
    memory: ws.memory.filter((m) => m.goalId !== goalId),
    predictions: ws.predictions.filter((p) => p.goalId !== goalId),
    calibrationDecisions: ws.calibrationDecisions.filter((c) => c.goalId !== goalId),
    accounts: ws.accounts.filter((a) => a.goalId !== goalId),
    cashFlows: ws.cashFlows.filter((c) => c.goalId !== goalId && !accountIds.has(c.accountId)),
    revenueStreams: ws.revenueStreams.filter((r) => r.goalId !== goalId),
    scenarioSettings: ws.scenarioSettings.filter((s) => s.goalId !== goalId),
    snapshots: ws.snapshots.filter((s) => s.goalId !== goalId),
    checkins: ws.checkins.filter((c) => c.goalId !== goalId),
  };
}

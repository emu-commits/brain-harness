import { describe, it } from 'vitest';
import fc from 'fast-check';
import type { Dependency, Range, WeekMinutes } from '../../src/core/model/types';
import type { ScheduleInput, ScheduleTask } from '../../src/core/engines/scheduler';
import { schedule } from '../../src/core/engines/scheduler';
import { buildGraph } from '../../src/core/engines/graph';
import { computeCpm } from '../../src/core/engines/cpm';
import type { FinanceInput } from '../../src/core/engines/finance';
import { projectFinances } from '../../src/core/engines/finance';
import { addDays } from '../../src/core/util/dates';

// Property tests (SPEC §14).

const rangeArb = (max: number, min = 0): fc.Arbitrary<Range> =>
  fc
    .tuple(fc.integer({ min, max }), fc.integer({ min, max }), fc.integer({ min, max }))
    .map(([a, b, c]) => {
      const [low, base, high] = [a, b, c].sort((x, y) => x - y) as [number, number, number];
      return { low, base, high };
    });

const weekArb: fc.Arbitrary<WeekMinutes> = fc
  .array(fc.integer({ min: 0, max: 240 }), { minLength: 7, maxLength: 7 })
  .filter((w) => w.some((m) => m > 0)) as fc.Arbitrary<WeekMinutes>;

interface Model {
  tasks: ScheduleTask[];
  deps: Dependency[];
  week: WeekMinutes;
}

const modelArb = (opts: { waits?: boolean; lags?: boolean } = {}): fc.Arbitrary<Model> =>
  fc.integer({ min: 1, max: 7 }).chain((n) =>
    fc
      .record({
        specs: fc.array(
          fc.record({
            // ≥ 15: the spec's 15-minute floor for zero-remaining tasks is itself non-monotone below it.
            est: rangeArb(300, 15),
            wait: opts.waits ? fc.boolean() : fc.constant(false),
            waitDays: rangeArb(5),
            priority: fc.constantFrom(1 as const, 2 as const, 3 as const),
          }),
          { minLength: n, maxLength: n },
        ),
        edges: fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: n - 1 }),
            fc.integer({ min: 0, max: n - 1 }),
            fc.integer({ min: 0, max: 2 }),
          ),
          { maxLength: n * 2 },
        ),
        week: weekArb,
      })
      .map(({ specs, edges, week }) => {
        const tasks: ScheduleTask[] = specs.map((s, i) => ({
          id: `t${i}`,
          milestoneId: 'M',
          kind: s.wait ? 'wait' : 'work',
          status: 'ready',
          priority: s.priority,
          createdAt: `2026-01-01T00:00:0${i}.000Z`,
          ...(s.wait ? { waitDays: s.waitDays } : { estimateMinutes: s.est }),
        }));
        const seen = new Set<string>();
        const deps: Dependency[] = [];
        for (const [a, b, lag] of edges) {
          const [from, to] = a < b ? [a, b] : [b, a];
          if (from === to || seen.has(`${from}>${to}`)) continue;
          seen.add(`${from}>${to}`);
          deps.push({
            id: `d${deps.length}`,
            fromTaskId: `t${from}`,
            toTaskId: `t${to}`,
            lagDays: opts.lags === false ? 0 : lag,
          });
        }
        return { tasks, deps, week };
      }),
  );

const input = (m: Model, over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  today: '2026-01-05',
  tasks: m.tasks,
  dependencies: m.deps,
  milestoneIds: ['M'],
  minutesByWeekday: m.week,
  loggedMinutes: {},
  pick: 'base',
  durationMult: 1,
  capacityMult: 1,
  calibration: {},
  blockedAssumeDays: 7,
  horizonDays: 3000,
  ...over,
});

function completion(i: ScheduleInput): string {
  const r = schedule(i);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.completion!;
}

// Monotonicity holds exactly when the single worker never idles while work remains: no lags and
// no waits. With lags or waits, greedy non-preemptive list scheduling has classic anomalies
// (more capacity can finish a task early, release a long critical task, and delay a lagged
// chain). See docs/DECISIONS.md. Those properties are therefore checked on lag-free,
// wait-free graphs; dependency and lag respect is checked on the full domain.
const workOnly = () => modelArb({ waits: false, lags: false });

describe('scheduler properties', () => {
  it('output respects every dependency and lag', () => {
    fc.assert(
      fc.property(modelArb({ waits: true }), (m) => {
        const r = schedule(input(m));
        if (!r.ok) return false;
        for (const d of m.deps) {
          const from = r.value.tasks[d.fromTaskId]!;
          const to = r.value.tasks[d.toTaskId]!;
          if (to.start! < addDays(from.finish, d.lagDays)) return false;
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });

  it('increasing a task duration never makes completion earlier', () => {
    fc.assert(
      fc.property(workOnly(), fc.nat(), fc.integer({ min: 1, max: 600 }), (m, pick, extra) => {
        const i = pick % m.tasks.length;
        const t = m.tasks[i]!;
        const est = t.estimateMinutes!;
        const bigger = {
          ...m,
          tasks: m.tasks.map((x, j) =>
            j === i
              ? {
                  ...x,
                  estimateMinutes: { ...est, base: est.base + extra, high: est.high + extra },
                }
              : x,
          ),
        };
        return completion(input(bigger)) >= completion(input(m));
      }),
      { numRuns: 500 },
    );
  });

  it('increasing capacity never makes completion later', () => {
    fc.assert(
      fc.property(
        workOnly(),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 1, max: 240 }),
        (m, day, extra) => {
          const week = m.week.map((w, j) => (j === day ? w + extra : w)) as WeekMinutes;
          return completion(input({ ...m, week })) <= completion(input(m));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('conservative ≥ base ≥ optimistic', () => {
    fc.assert(
      fc.property(workOnly(), (m) => {
        const c = completion(input(m, { pick: 'high' }));
        const b = completion(input(m, { pick: 'base' }));
        const o = completion(input(m, { pick: 'low' }));
        return c >= b && b >= o;
      }),
      { numRuns: 500 },
    );
  });

  it('removing a dependency never makes any earliest start later', () => {
    fc.assert(
      fc.property(modelArb({ waits: true }), fc.nat(), (m, k) => {
        if (!m.deps.length) return true;
        const durations = new Map(
          m.tasks.map((t) => [
            t.id,
            t.estimateMinutes ? t.estimateMinutes.base / 60 : t.waitDays!.base,
          ]),
        );
        const before = computeCpm({ graph: buildGraph(m.tasks, m.deps), durations }).nodes;
        const fewer = m.deps.filter((_, j) => j !== k % m.deps.length);
        const after = computeCpm({ graph: buildGraph(m.tasks, fewer), durations }).nodes;
        return m.tasks.every((t) => after.get(t.id)!.es <= before.get(t.id)!.es + 1e-9);
      }),
      { numRuns: 500 },
    );
  });
});

describe('finance properties', () => {
  const finArb = fc.record({
    runwayBal: fc.integer({ min: -100000, max: 1000000 }),
    savingsBal: fc.integer({ min: 0, max: 1000000 }),
    rate: rangeArb(20).map((r) => ({ low: r.low / 100, base: r.base / 100, high: r.high / 100 })),
    contrib: fc.integer({ min: 0, max: 50000 }),
    cost: rangeArb(200000),
    finishDay: fc.integer({ min: 0, max: 300 }),
    revenue: rangeArb(100000),
    ramp: rangeArb(6),
  });
  const build = (f: Parameters<typeof mk>[0]) => mk(f);
  function mk(f: {
    runwayBal: number;
    savingsBal: number;
    rate: Range;
    contrib: number;
    cost: Range;
    finishDay: number;
    revenue: Range;
    ramp: Range;
  }): FinanceInput {
    return {
      startMonth: '2026-01',
      horizonMonths: 24,
      picks: { cost: 'base', revenue: 'base', ramp: 'base', assetRate: 'base', debtRate: 'base' },
      costMult: 1,
      revenueMult: 1,
      inflationAnnual: 0.03,
      accounts: [
        {
          id: 'a',
          goalId: 'g',
          name: 'cash',
          type: 'cash',
          balance: f.runwayBal,
          annualRate: f.rate,
          monthlyContribution: 0,
          isRunwaySource: true,
        },
        {
          id: 'b',
          goalId: 'g',
          name: 'savings',
          type: 'savings',
          balance: f.savingsBal,
          annualRate: f.rate,
          monthlyContribution: f.contrib,
          isRunwaySource: false,
        },
      ],
      cashFlows: [],
      revenueStreams: [
        {
          id: 's',
          goalId: 'g',
          name: 'sales',
          accountId: 'a',
          startMonth: '2026-04',
          rampMonths: f.ramp,
          targetMonthly: f.revenue,
        },
      ],
      taskCosts: [{ taskId: 't', finish: addDays('2026-01-05', f.finishDay), cost: f.cost }],
      milestoneDates: {},
    };
  }
  const last = (i: FinanceInput) => projectFinances(i).months.at(-1)!;

  it('increasing a cost never reduces total cost or ending runway', () => {
    fc.assert(
      fc.property(finArb, fc.integer({ min: 1, max: 100000 }), (f, extra) => {
        const a = build(f);
        const b = build({
          ...f,
          cost: { ...f.cost, base: f.cost.base + extra, high: f.cost.high + extra },
        });
        const pa = projectFinances(a);
        const pb = projectFinances(b);
        return pb.totalGoalCost >= pa.totalGoalCost && last(b).runway! <= last(a).runway!;
      }),
      { numRuns: 500 },
    );
  });

  it('adding a positive contribution never reduces ending assets', () => {
    fc.assert(
      fc.property(finArb, fc.integer({ min: 1, max: 50000 }), (f, extra) => {
        const a = build(f);
        const b = build({ ...f, contrib: f.contrib + extra });
        return last(b).balances.b! >= last(a).balances.b! && last(b).netWorth >= last(a).netWorth;
      }),
      { numRuns: 500 },
    );
  });

  it('money stays integer cents', () => {
    fc.assert(
      fc.property(finArb, (f) =>
        projectFinances(build(f)).months.every(
          (r) => Number.isInteger(r.netWorth) && Object.values(r.balances).every(Number.isInteger),
        ),
      ),
      { numRuns: 200 },
    );
  });
});

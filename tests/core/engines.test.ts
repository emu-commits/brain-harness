import { describe, expect, it } from 'vitest';
import { buildGraph, cyclePathIfAdded } from '../../src/core/engines/graph';
import { computeCpm } from '../../src/core/engines/cpm';
import { schedule } from '../../src/core/engines/scheduler';
import { buildForecastInputs, runForecast, runScenario } from '../../src/core/engines/scenarios';
import {
  acceptedCalibration,
  allSuggestions,
  calibrationSamples,
  dateErrors,
  medianAbsError,
} from '../../src/core/engines/calibration';
import { evaluateTriggers } from '../../src/core/engines/triggers';
import {
  applyChange,
  createSnapshot,
  diffInputs,
  diffSnapshots,
  hashInputs,
} from '../../src/core/engines/snapshots';
import { readyTaskIds, selectNextAction } from '../../src/core/engines/nextAction';
import { NOW, TODAY, sampleWorkspace } from './helpers';
import type { Workspace } from '../../src/core/model/types';

describe('graph', () => {
  it('names the loop a new dependency would close', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const deps = [
      { id: '1', fromTaskId: 'a', toTaskId: 'b', lagDays: 0 },
      { id: '2', fromTaskId: 'b', toTaskId: 'c', lagDays: 0 },
    ];
    expect(cyclePathIfAdded(nodes, deps, 'c', 'a')).toEqual(['a', 'b', 'c']);
    expect(cyclePathIfAdded(nodes, deps, 'a', 'c')).toBeNull();
    expect(cyclePathIfAdded(nodes, deps, 'a', 'a')).toEqual(['a']);
  });
});

describe('cpm', () => {
  it('computes float and critical path with lags', () => {
    const deps = [
      { id: '1', fromTaskId: 'a', toTaskId: 'c', lagDays: 1 },
      { id: '2', fromTaskId: 'b', toTaskId: 'c', lagDays: 0 },
    ];
    const g = buildGraph([{ id: 'a' }, { id: 'b' }, { id: 'c' }], deps);
    const { nodes, projectEnd } = computeCpm({
      graph: g,
      durations: new Map([
        ['a', 2],
        ['b', 1],
        ['c', 1],
      ]),
    });
    expect(projectEnd).toBe(4);
    expect(nodes.get('a')).toMatchObject({ es: 0, ef: 2, float: 0, critical: true });
    expect(nodes.get('b')).toMatchObject({ es: 0, ef: 1, ls: 2, float: 2, critical: false });
    expect(nodes.get('c')).toMatchObject({ es: 3, ef: 4, critical: true });
  });
});

describe('scheduler', () => {
  it('respects earliest start and horizon', () => {
    const r = schedule({
      today: '2026-01-05',
      tasks: [
        {
          id: 'a',
          kind: 'work',
          status: 'ready',
          priority: 2,
          createdAt: 'x',
          estimateMinutes: { low: 60, base: 60, high: 60 },
          earliestStart: '2026-01-10',
        },
      ],
      dependencies: [],
      milestoneIds: [],
      minutesByWeekday: [60, 60, 60, 60, 60, 60, 60],
      loggedMinutes: {},
      pick: 'base',
      durationMult: 1,
      capacityMult: 1,
      calibration: {},
      blockedAssumeDays: 7,
      horizonDays: 3,
    });
    expect(r).toEqual({ ok: false, error: { kind: 'unschedulable', taskIds: ['a'] } });
  });
});

describe('scenarios', () => {
  it('orders conservative ≥ base ≥ optimistic and records picks', () => {
    const { ws, goal } = sampleWorkspace({ chain: true });
    const f = runForecast(buildForecastInputs(ws, goal.id, TODAY));
    expect(f.conservative.goalCompletion! >= f.base.goalCompletion!).toBe(true);
    expect(f.base.goalCompletion! >= f.optimistic.goalCompletion!).toBe(true);
    expect(f.conservative.picks.duration).toBe('high');
    expect(f.optimistic.picks.revenue).toBe('high');
    expect(f.base.traces.completion?.formula).toMatch(/remaining/);
  });

  it('dates a net-worth goal by the first month the target is reached', () => {
    const { ws, goal } = sampleWorkspace();
    const g = {
      ...goal,
      successCriteria: [
        {
          id: 'c',
          description: 'Savings',
          metric: 'net worth',
          unit: 'USD',
          target: 130000,
          deadline: '2026-12-31',
          trackedBy: { kind: 'netWorth' as const },
        },
      ],
    };
    const w: Workspace = {
      ...ws,
      goals: [g],
      accounts: [
        {
          id: 'acc',
          goalId: g.id,
          name: 'Savings',
          type: 'savings',
          balance: 100000,
          annualRate: { low: 0, base: 0, high: 0 },
          monthlyContribution: 10000,
          isRunwaySource: true,
        },
      ],
    };
    const base = runScenario(buildForecastInputs(w, g.id, TODAY), 'base');
    // 100000 + 3 × 10000 = 130000 at the end of March 2026 (month 2).
    expect(base.goalCompletion).toBe('2026-03-31');
    expect(base.netWorthAtTarget).toBe(100000 + 6 * 10000);
  });
});

describe('calibration', () => {
  it('builds samples from completed work and accepts the latest decision per category', () => {
    const { ws, goal, tasks } = sampleWorkspace();
    const done = {
      ...tasks[0]!,
      status: 'completed' as const,
      completedAt: NOW,
      category: 'calls',
    };
    const w: Workspace = {
      ...ws,
      tasks: [done, tasks[1]!],
      executionRecords: [
        { id: 'r', taskId: done.id, sessionId: 's', startedAt: NOW, endedAt: NOW, minutes: 90 },
      ],
    };
    expect(calibrationSamples(w, goal.id)).toEqual([
      { taskId: done.id, category: 'calls', estimateBase: 60, actualMinutes: 90, completedAt: NOW },
    ]);
    expect(allSuggestions(calibrationSamples(w, goal.id), 10, 1).map((s) => s.multiplier)).toEqual([
      1.5, 1.5,
    ]);
    expect(
      acceptedCalibration([
        {
          id: '1',
          goalId: 'g',
          category: '*',
          multiplier: 1.2,
          acceptedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: '2',
          goalId: 'g',
          category: '*',
          multiplier: 1.4,
          acceptedAt: '2026-02-01T00:00:00Z',
        },
        {
          id: '3',
          goalId: 'g',
          category: 'calls',
          multiplier: 2,
          acceptedAt: '2026-01-01T00:00:00Z',
        },
      ]),
    ).toEqual({ '*': 1.4, calls: 2 });
  });

  it('measures forecasting skill from realized predictions', () => {
    const errs = dateErrors([
      {
        id: 'p1',
        goalId: 'g',
        subject: 'goalDate',
        subjectId: 'g',
        predicted: '2026-03-01',
        realized: '2026-03-11',
        createdAt: '1',
      },
      {
        id: 'p2',
        goalId: 'g',
        subject: 'milestoneDate',
        subjectId: 'm',
        predicted: '2026-03-01',
        realized: '2026-02-27',
        createdAt: '2',
      },
      {
        id: 'p3',
        goalId: 'g',
        subject: 'goalDate',
        subjectId: 'g',
        predicted: '2026-03-01',
        createdAt: '3',
      },
    ]);
    expect(errs.map((e) => e.errorDays)).toEqual([10, -2]);
    expect(medianAbsError(errs)).toBe(6);
  });
});

describe('triggers', () => {
  it('fires on overruns, late critical tasks, assumption changes and inbox capture', () => {
    const { ws, goal, tasks } = sampleWorkspace();
    const late = {
      ...tasks[0]!,
      status: 'completed' as const,
      completedAt: '2026-01-09T10:00:00.000Z',
      cost: { low: 100, base: 1000, high: 2000 },
    };
    const inbox = {
      ...tasks[1]!,
      id: 'inbox',
      milestoneId: undefined,
      addedOutsidePlan: true,
      createdAt: '2026-01-06T00:00:00.000Z',
    };
    const w: Workspace = {
      ...ws,
      tasks: [late, tasks[1]!, inbox],
      executionRecords: [
        {
          id: 'r',
          taskId: late.id,
          sessionId: 's',
          startedAt: NOW,
          endedAt: NOW,
          minutes: 80,
          cost: 1200,
        },
      ],
      assumptions: [
        {
          id: 'as',
          goalId: goal.id,
          statement: 'Rent ≤ 1500',
          confidence: 'low',
          status: 'contradicted',
          history: [{ at: '2026-01-07T00:00:00.000Z', status: 'contradicted' }],
        },
      ],
    };
    const kinds = evaluateTriggers({
      ws: w,
      goalId: goal.id,
      since: NOW,
      baseline: { [late.id]: { finish: '2026-01-06', critical: true } },
    }).map((t) => t.kind);
    expect(kinds.sort()).toEqual([
      'assumptionChanged',
      'costOverrun',
      'criticalLate',
      'taskOverrun',
      'unplannedChange',
    ]);
    expect(evaluateTriggers({ ws: w, goalId: goal.id, since: '2026-02-01T00:00:00.000Z' })).toEqual(
      [],
    );
  });
});

describe('snapshots', () => {
  it('hashes stably and diffs inputs, outputs and attribution', () => {
    const { ws, goal, tasks, ids, clock } = sampleWorkspace({ chain: true });
    const a = buildForecastInputs(ws, goal.id, TODAY);
    expect(hashInputs(a)).toBe(hashInputs(structuredClone(a)));

    const bigger = { ...tasks[1]!, estimateMinutes: { low: 60, base: 240, high: 300 } };
    const ws2: Workspace = { ...ws, tasks: [tasks[0]!, bigger] };
    const b = buildForecastInputs(ws2, goal.id, TODAY);
    const changes = diffInputs(a, b);
    expect(changes).toEqual([
      {
        collection: 'tasks',
        id: bigger.id,
        field: 'estimateMinutes',
        kind: 'changed',
        old: { low: 30, base: 60, high: 120 },
        new: bigger.estimateMinutes,
      },
    ]);
    expect(hashInputs(applyChange(a, changes[0]!))).toBe(hashInputs(b));

    const sa = createSnapshot(a, runForecast(a), 'initial', ids, clock);
    const sb = createSnapshot(b, runForecast(b), 'reforecast', ids, clock);
    const d = diffSnapshots(sa, sb);
    expect(d.outputDeltas.base.goalCompletion.days).toBe(3);
    expect(d.attribution).toHaveLength(1);
    expect(d.attribution[0]!.goalDays).toBe(3);
  });
});

describe('next action', () => {
  it('picks the first ready task in schedule order, adjusted by energy in peak windows', () => {
    const { ws, goal, tasks } = sampleWorkspace({
      tasks: [
        { title: 'Deep', energy: 'deep' },
        { title: 'Shallow', energy: 'shallow' },
        { title: 'Later' },
      ],
      chain: false,
    });
    const cap = {
      goalId: goal.id,
      minutesByWeekday: [60, 60, 60, 60, 60, 60, 60] as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ],
      peakWindows: [{ weekday: 1, start: '08:00', end: '11:00' }],
    };
    const base = {
      tasks: ws.tasks,
      dependencies: [],
      scheduleOrder: tasks.map((t) => t.id),
      today: TODAY,
      capacity: cap,
    };
    expect(selectNextAction({ ...base, local: { weekday: 1, hhmm: '09:00' } })?.taskId).toBe(
      tasks[0]!.id,
    );
    expect(selectNextAction({ ...base, local: { weekday: 1, hhmm: '14:00' } })?.taskId).toBe(
      tasks[1]!.id,
    );
    expect(
      selectNextAction({
        ...base,
        capacity: { ...cap, peakWindows: [] },
        local: { weekday: 1, hhmm: '14:00' },
      })?.taskId,
    ).toBe(tasks[0]!.id);
  });
  it('only offers tasks whose predecessors are complete', () => {
    const { ws } = sampleWorkspace({ chain: true });
    expect([...readyTaskIds(ws.tasks, ws.dependencies, TODAY)]).toEqual([ws.tasks[0]!.id]);
  });
});

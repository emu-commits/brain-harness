import { describe, expect, it } from 'vitest';
import {
  isEarlyStop,
  obstacleMomentAvailable,
  parseIfThen,
  pendingRevision,
  todaysPlan,
  woopDue,
} from '../../src/core/harness/woop';
import { completionProgress, doneLog, milestoneProgress } from '../../src/core/engines/progress';
import { validateWorkspace } from '../../src/core/validation/validate';
import type { CheckIn, Workspace } from '../../src/core/model/types';
import { sampleWorkspace } from './helpers';

const ci = (p: Partial<CheckIn>): CheckIn => ({
  id: `c${Math.random()}`.slice(0, 8),
  goalId: 'g',
  at: '2026-01-05T09:00:00.000Z',
  day: '2026-01-05',
  kind: 'woop',
  ...p,
});

describe('parseIfThen', () => {
  it('splits the common shapes and rejects the rest', () => {
    expect(parseIfThen('When I stall, I will do five minutes')).toEqual({
      when: 'I stall',
      then: 'do five minutes',
    });
    expect(parseIfThen('If it rains then I’ll use the treadmill.')).toEqual({
      when: 'it rains',
      then: 'use the treadmill',
    });
    expect(parseIfThen('whenever I open email, then close it')).toEqual({
      when: 'I open email',
      then: 'close it',
    });
    expect(parseIfThen('Do five minutes')).toBeNull();
  });
});

describe('WOOP cadence', () => {
  it('waits a day after the first run, then repeats every N days, counting skips', () => {
    const { ws, goal } = sampleWorkspace();
    const w = { ...ws, goals: [{ ...goal, createdAt: '2026-01-05T08:00:00.000Z' }] };
    expect(woopDue(w, goal.id, '2026-01-05T20:00:00.000Z')).toBe(false);
    expect(woopDue(w, goal.id, '2026-01-06T09:00:00.000Z')).toBe(true);
    const done: Workspace = {
      ...w,
      checkins: [
        ci({ goalId: goal.id, at: '2026-01-06T09:00:00.000Z', day: '2026-01-06', skipped: true }),
      ],
    };
    expect(woopDue(done, goal.id, '2026-01-08T09:00:00.000Z')).toBe(false);
    expect(woopDue(done, goal.id, '2026-01-09T09:00:00.000Z')).toBe(true);
    const off: Workspace = {
      ...done,
      settings: [
        { ...(done.settings[0] ?? ({} as never)), id: 'settings', woopEveryDays: 0 } as never,
      ],
    };
    expect(woopDue(off, goal.id, '2026-02-09T09:00:00.000Z')).toBe(false);
  });

  it('is never due without a charter to rehearse', () => {
    const { ws, goal } = sampleWorkspace();
    const bare = {
      ...ws,
      goals: [
        {
          ...goal,
          createdAt: '2025-01-01T00:00:00.000Z',
          charter: { ...goal.charter, why: '', obstaclePlan: '' },
        },
      ],
    };
    expect(woopDue(bare, goal.id, '2026-01-05T09:00:00.000Z')).toBe(false);
  });

  it("returns today's plan and a pending revision", () => {
    const { ws, goal } = sampleWorkspace();
    const w: Workspace = {
      ...ws,
      checkins: [
        ci({ goalId: goal.id, day: '2026-01-04', todayPlan: 'old' }),
        ci({
          goalId: goal.id,
          at: '2026-01-05T10:00:00.000Z',
          obstacleToday: 'meetings',
          todayPlan: 'When a meeting runs over, I will do 10 minutes after',
          revisedPlan: 'When I stall, I will set a 5-minute timer',
          revisedPlanStatus: 'pending',
        }),
      ],
    };
    expect(todaysPlan(w, goal.id, '2026-01-05')).toEqual({
      obstacle: 'meetings',
      plan: 'When a meeting runs over, I will do 10 minutes after',
    });
    expect(todaysPlan(w, goal.id, '2026-01-06')).toBeNull();
    expect(pendingRevision(w, goal.id)?.revisedPlan).toMatch(/5-minute timer/);
    expect(validateWorkspace(w)).toEqual([]);
  });
});

describe('obstacle moments', () => {
  it('detects early stops and offers the moment at most once per session', () => {
    expect(isEarlyStop(10, 60)).toBe(true);
    expect(isEarlyStop(30, 60)).toBe(false);
    expect(isEarlyStop(5, undefined)).toBe(false);
    const { ws, goal } = sampleWorkspace();
    expect(obstacleMomentAvailable(ws, goal.id, 's1')).toBe(true);
    const shown = {
      ...ws,
      checkins: [
        ci({ goalId: goal.id, kind: 'obstacleMoment', sessionId: 's1', trigger: 'stoppedEarly' }),
      ],
    };
    expect(obstacleMomentAvailable(shown, goal.id, 's1')).toBe(false);
    expect(obstacleMomentAvailable(shown, goal.id, 's2')).toBe(true);
    const noPlan = { ...ws, goals: [{ ...goal, charter: { ...goal.charter, obstaclePlan: '' } }] };
    expect(obstacleMomentAvailable(noPlan, goal.id, 's9')).toBe(false);
  });
});

describe('progress', () => {
  it('reports what a completion unlocked and how close the milestone is', () => {
    const { ws, tasks, goal, milestone } = sampleWorkspace({
      tasks: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
      chain: true,
    });
    const w: Workspace = {
      ...ws,
      tasks: [
        { ...tasks[0]!, status: 'completed', completedAt: '2026-01-05T10:00:00.000Z' },
        tasks[1]!,
        tasks[2]!,
      ],
    };
    const p = completionProgress(w, tasks[0]!.id);
    expect(p.unlocked.map((u) => u.title)).toEqual(['B']);
    expect(p.milestone).toMatchObject({
      title: milestone.title,
      doneTasks: 1,
      totalTasks: 3,
      pct: 33,
      reached: false,
    });
    expect(p.milestone!.remaining.map((r) => r.title)).toEqual(['B', 'C']);
    expect(p.goal).toEqual({ doneTasks: 1, totalTasks: 3 });

    const all: Workspace = {
      ...w,
      tasks: w.tasks.map((t) => ({
        ...t,
        status: 'completed' as const,
        completedAt: '2026-01-06T10:00:00.000Z',
      })),
    };
    expect(milestoneProgress(all, milestone.id)?.reached).toBe(true);
    expect(completionProgress(all, tasks[2]!.id).unlocked).toEqual([]);
    expect(doneLog(all, goal.id).map((d) => d.title)).toHaveLength(3);
  });

  it('does not count something as unlocked while another predecessor is open', () => {
    const { ws, tasks } = sampleWorkspace({
      tasks: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
    });
    const deps = [
      { id: 'd1', fromTaskId: tasks[0]!.id, toTaskId: tasks[2]!.id, lagDays: 0 },
      { id: 'd2', fromTaskId: tasks[1]!.id, toTaskId: tasks[2]!.id, lagDays: 0 },
    ];
    const w: Workspace = {
      ...ws,
      dependencies: deps,
      tasks: [{ ...tasks[0]!, status: 'completed', completedAt: 'x' }, tasks[1]!, tasks[2]!],
    };
    expect(completionProgress(w, tasks[0]!.id).unlocked).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  activeSession,
  checkModePermissions,
  endSession,
  startSession,
} from '../../src/core/harness/sessions';
import {
  charterLine,
  preTaskHook,
  sessionEndHook,
  sessionStartHook,
  weeklyHook,
} from '../../src/core/harness/hooks';
import { assembleContext } from '../../src/core/harness/context';
import { detectStuck } from '../../src/core/harness/stuck';
import { promotedLevel } from '../../src/core/harness/scaffold';
import { DEFAULT_SETTINGS } from '../../src/core/model/factories';
import { fixedClock } from '../../src/core/util/clock';
import type { Session, Workspace } from '../../src/core/model/types';
import { NOW, TODAY, sampleWorkspace } from './helpers';

describe('sessions', () => {
  it('starting a session ends the open one', () => {
    const { ws, goal, ids, clock } = sampleWorkspace();
    const a = startSession(ws, goal.id, 'plan', ids, clock);
    const b = startSession(a.ws, goal.id, 'execute', ids, clock);
    expect(b.ws.sessions.filter((s) => !s.endedAt)).toHaveLength(1);
    expect(activeSession(b.ws)?.mode).toBe('execute');
    const c = endSession(b.ws, b.session.id, clock, { handoffNote: 'next: call' });
    expect(activeSession(c)).toBeUndefined();
  });

  it('execute mode may change task status but not structure or the charter', () => {
    const { ws, goal, tasks, milestone } = sampleWorkspace();
    const statusOnly: Workspace = {
      ...ws,
      tasks: [{ ...tasks[0]!, status: 'inProgress' }, tasks[1]!],
    };
    expect(checkModePermissions(ws, statusOnly, 'execute')).toEqual([]);

    const retitled: Workspace = { ...ws, tasks: [{ ...tasks[0]!, title: 'New' }, tasks[1]!] };
    expect(checkModePermissions(ws, retitled, 'execute')[0]?.message).toMatch(/title/);

    const charter: Workspace = {
      ...ws,
      goals: [{ ...goal, charter: { ...goal.charter, why: 'x' } }],
    };
    expect(checkModePermissions(ws, charter, 'execute')).toHaveLength(1);
    expect(checkModePermissions(ws, charter, 'review')).toHaveLength(1);
    expect(checkModePermissions(ws, charter, 'plan')).toEqual([]);

    const inbox = { ...tasks[0]!, id: 'new', milestoneId: undefined };
    expect(checkModePermissions(ws, { ...ws, tasks: [...ws.tasks, inbox] }, 'execute')).toEqual([]);
    const planned = { ...inbox, milestoneId: milestone.id };
    expect(
      checkModePermissions(ws, { ...ws, tasks: [...ws.tasks, planned] }, 'execute'),
    ).toHaveLength(1);
    expect(
      checkModePermissions(
        ws,
        {
          ...ws,
          dependencies: [{ id: 'd', fromTaskId: tasks[0]!.id, toTaskId: tasks[1]!.id, lagDays: 0 }],
        },
        'execute',
      ),
    ).toHaveLength(1);
  });
});

describe('hooks', () => {
  it('shows the handoff first after the resume threshold', () => {
    const { ws, goal } = sampleWorkspace();
    const s: Session = {
      id: 's1',
      goalId: goal.id,
      mode: 'execute',
      startedAt: '2026-01-01T09:00:00.000Z',
      endedAt: '2026-01-02T09:00:00.000Z',
      handoffNote: 'Stopped mid-outline; next: section 3',
    };
    const w = { ...ws, sessions: [s] };
    expect(sessionStartHook(w, goal.id, '2026-01-04T08:00:00.000Z').resume).toBeNull();
    const later = sessionStartHook(w, goal.id, '2026-01-05T09:00:00.000Z');
    expect(later.resume).toEqual({
      handoffNote: 'Stopped mid-outline; next: section 3',
      lastSessionId: 's1',
      daysAway: 3,
    });
    expect(later.charterLine).toBe(charterLine(goal));
  });

  it('pre/post/end hooks return the right prompts', () => {
    const { tasks } = sampleWorkspace();
    expect(preTaskHook(tasks[0]!)).toEqual({
      definitionOfDone: 'done',
      predictedMinutesDefault: 60,
      askIntention: true,
    });
    expect(sessionEndHook({ id: 's', goalId: 'g', mode: 'execute', startedAt: NOW }).kind).toBe(
      'handoff',
    );
    expect(sessionEndHook({ id: 's', goalId: 'g', mode: 'plan', startedAt: NOW }).kind).toBe(
      'memory',
    );
  });

  it('weekly review is due 7 days after the last review', () => {
    const { ws, goal } = sampleWorkspace();
    const created = { ...ws, goals: [{ ...goal, createdAt: '2026-01-01T00:00:00.000Z' }] };
    expect(weeklyHook(created, goal.id, '2026-01-07T00:00:00.000Z')).toBe(false);
    expect(weeklyHook(created, goal.id, '2026-01-08T00:00:00.000Z')).toBe(true);
  });
});

describe('context assembler', () => {
  it('returns only what the execute card needs', () => {
    const { ws, goal, tasks } = sampleWorkspace({
      tasks: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
      chain: true,
    });
    const ctx = assembleContext(ws, 'execute', {
      goalId: goal.id,
      taskId: tasks[1]!.id,
      today: TODAY,
    });
    expect(ctx.resolved.map((r) => r.title)).toEqual(['A']);
    expect(ctx.unlocks).toEqual({ count: 1, titles: ['C'] });
    expect(ctx.charterLine).toContain('hands');
    expect(Object.keys(ctx).sort()).toEqual([
      'assumption',
      'charterLine',
      'handoff',
      'resolved',
      'task',
      'unlocks',
    ]);
  });
});

describe('stuck detector', () => {
  it('flags repeated sessions without evidence, overruns and long blocks', () => {
    const { ws, goal, tasks } = sampleWorkspace();
    const t0 = { ...tasks[0]!, status: 'inProgress' as const };
    const t1 = { ...tasks[1]!, status: 'blocked' as const, blockedAt: '2025-12-01T00:00:00.000Z' };
    const sessions: Session[] = ['a', 'b', 'c'].map((id) => ({
      id,
      goalId: goal.id,
      mode: 'execute',
      startedAt: NOW,
      endedAt: NOW,
    }));
    const recs = sessions.map((s, i) => ({
      id: `r${i}`,
      taskId: t0.id,
      sessionId: s.id,
      startedAt: NOW,
      endedAt: `2026-01-0${i + 2}T00:00:00.000Z`,
      minutes: 70,
    }));
    const w: Workspace = { ...ws, tasks: [t0, t1], sessions, executionRecords: recs };
    const stuck = detectStuck(w, goal.id, NOW, DEFAULT_SETTINGS.stuck);
    expect(stuck[t0.id]!.map((r) => r.kind)).toEqual(['sessions', 'overrun']);
    expect(stuck[t1.id]).toEqual([{ kind: 'blocked', days: 35 }]);
    // New evidence resets the session count.
    const withEvidence = {
      ...w,
      evidence: [
        {
          id: 'e',
          taskId: t0.id,
          kind: 'note' as const,
          text: 'x',
          createdAt: '2026-01-03T12:00:00.000Z',
        },
      ],
    };
    expect(
      detectStuck(withEvidence, goal.id, NOW, DEFAULT_SETTINGS.stuck)[t0.id]!.map((r) => r.kind),
    ).toEqual(['overrun']);
  });
});

describe('scaffold', () => {
  const plan = (i: number, resolved: number, stuckTaps = 0): Session => ({
    id: `p${i}`,
    goalId: 'g',
    mode: 'plan',
    startedAt: `2026-01-0${i}T00:00:00Z`,
    endedAt: `2026-01-0${i}T01:00:00Z`,
    gapStats: { shown: 5, resolved, stuckTaps },
  });
  it('promotes after three strong sessions, never demotes, one step at a time', () => {
    const { goal } = sampleWorkspace();
    const g = { ...goal, id: 'g' };
    expect(promotedLevel(g, [plan(1, 5), plan(2, 4)])).toBe(1);
    expect(promotedLevel(g, [plan(1, 5), plan(2, 4), plan(3, 4, 1)])).toBe(1);
    expect(promotedLevel(g, [plan(1, 5), plan(2, 4), plan(3, 4)])).toBe(2);
    expect(
      promotedLevel({ ...g, scaffoldLevel: 2, scaffoldChangedAt: '2026-01-02T00:00:00Z' }, [
        plan(1, 5),
        plan(2, 4),
        plan(3, 4),
      ]),
    ).toBe(2);
    expect(promotedLevel({ ...g, scaffoldLevel: 3 }, [])).toBe(3);
  });
  void fixedClock;
});

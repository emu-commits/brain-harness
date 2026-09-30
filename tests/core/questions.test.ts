import { describe, expect, it } from 'vitest';
import { applyAnswer } from '../../src/core/questions/apply';
import { CHARTER_SEQUENCE, bindQuestion, promptFor, question } from '../../src/core/questions/bank';
import { detectGaps, gapQuestion, sessionGaps } from '../../src/core/questions/gaps';
import type { Answer } from '../../src/core/questions/types';
import { emptyWorkspace } from '../../src/core/model/factories';
import { validateWorkspace } from '../../src/core/validation/validate';
import { hashValue } from '../../src/core/util/hash';
import type { Workspace } from '../../src/core/model/types';
import { TODAY, sampleWorkspace, setup } from './helpers';

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe('charter sequence C1–C8', () => {
  it('drives a new user to a valid model with a goal, charter, milestone and first task', () => {
    const { ids, clock } = setup();
    const answers: Record<string, Answer> = {
      C1: { type: 'text', value: 'Run a half marathon' },
      C2: {
        type: 'criterion',
        description: 'Official finish time on the results page',
        metric: 'race finished',
        target: 1,
        unit: 'race',
      },
      C3: { type: 'date', value: '2026-10-18' },
      C4: { type: 'text', value: 'Prove to myself I can train consistently' },
      C5: { type: 'text', value: 'I skip runs when the weather is bad' },
      C6: { type: 'ifThen', when: 'it rains', then: 'do the treadmill plan instead' },
      C7: { type: 'text', value: 'I can run 10 km without stopping' },
      C8: {
        type: 'firstTask',
        title: 'Run 2 km easy',
        when: 'Tuesday 7am',
        where: 'the park loop',
        definitionOfDone: 'Watch shows 2 km',
      },
    };
    let ws: Workspace = emptyWorkspace();
    let goalId: string | undefined;
    for (const id of CHARTER_SEQUENCE) {
      const r = must(applyAnswer(ws, question(id), answers[id]!, { goalId, ids, clock }));
      ws = r.ws;
      goalId = r.goalId;
      expect(validateWorkspace(ws)).toEqual([]);
    }
    const g = ws.goals[0]!;
    expect(g.title).toBe('Run a half marathon');
    expect(g.targetDate).toBe('2026-10-18');
    expect(g.successCriteria[0]).toMatchObject({
      metric: 'race finished',
      target: 1,
      deadline: '2026-10-18',
    });
    expect(g.charter.obstaclePlan).toBe('When it rains, I will do the treadmill plan instead');
    expect(ws.milestones).toHaveLength(1);
    expect(ws.tasks[0]).toMatchObject({
      title: 'Run 2 km easy',
      milestoneId: ws.milestones[0]!.id,
      definitionOfDone: 'Watch shows 2 km',
      intention: { when: 'Tuesday 7am', where: 'the park loop' },
    });
  });

  it('rejects empty answers without changing anything', () => {
    const { ids, clock } = setup();
    const r = applyAnswer(
      emptyWorkspace(),
      question('C1'),
      { type: 'text', value: '  ' },
      { ids, clock },
    );
    expect(r.ok).toBe(false);
  });
});

describe('gap detector', () => {
  it('finds gaps in priority order and respects the session cap', () => {
    const { ws, goal } = sampleWorkspace({
      tasks: [
        { title: 'A', estimateMinutes: undefined, definitionOfDone: '' },
        { title: 'B', estimateMinutes: { low: 600, base: 600, high: 900 } },
      ],
    });
    const w: Workspace = { ...ws, capacities: [] };
    const codes = detectGaps(w, goal.id, TODAY).map((g) => g.code);
    expect(codes).toEqual(['G1', 'G2', 'G4', 'G5', 'G6', 'G7', 'G8']);
    expect(sessionGaps(w, goal.id, TODAY)).toHaveLength(5);
  });

  it('suppresses a dismissed gap until its object changes', () => {
    const { ws, goal, tasks } = sampleWorkspace({ tasks: [{ title: 'A', definitionOfDone: '' }] });
    const gap = detectGaps(ws, goal.id, TODAY).find((g) => g.code === 'G5')!;
    const dismissed: Workspace = {
      ...ws,
      gapDismissals: [{ id: 'd', gapKey: gap.key, objectHash: gap.objectHash, at: 'x' }],
    };
    expect(detectGaps(dismissed, goal.id, TODAY).some((g) => g.code === 'G5')).toBe(false);
    const changed = { ...dismissed, tasks: [{ ...tasks[0]!, title: 'A, renamed' }] };
    expect(detectGaps(changed, goal.id, TODAY).some((g) => g.code === 'G5')).toBe(true);
    expect(gap.objectHash).toBe(hashValue(tasks[0]));
  });

  it('scaffold level 3 only surfaces priority 1–2 gaps', () => {
    const { ws, goal } = sampleWorkspace({ tasks: [{ title: 'A', estimateMinutes: undefined }] });
    const w = { ...ws, goals: [{ ...goal, scaffoldLevel: 3 as const }] };
    expect(detectGaps(w, goal.id, TODAY).every((g) => g.priority <= 2)).toBe(true);
  });

  it('answers to gap questions write to the bound object', () => {
    const { ws, goal, tasks, ids, clock } = sampleWorkspace({
      tasks: [
        { title: 'Big', estimateMinutes: { low: 500, base: 600, high: 900 } },
        { title: 'After' },
      ],
    });
    const w: Workspace = {
      ...ws,
      dependencies: [{ id: 'd', fromTaskId: tasks[0]!.id, toTaskId: tasks[1]!.id, lagDays: 0 }],
    };
    const g7 = detectGaps(w, goal.id, TODAY).find((g) => g.code === 'G7')!;
    const r = must(
      applyAnswer(
        w,
        gapQuestion(g7),
        { type: 'taskList', titles: ['Part 1', 'Part 2'] },
        { goalId: goal.id, ids, clock },
      ),
    );
    const titles = r.ws.tasks.map((t) => t.title);
    expect(titles).toEqual(['After', 'Part 1', 'Part 2']);
    const p2 = r.ws.tasks.find((t) => t.title === 'Part 2')!;
    expect(
      r.ws.dependencies.some((d) => d.fromTaskId === p2.id && d.toTaskId === tasks[1]!.id),
    ).toBe(true);
  });

  it('rejects a dependency answer that would create a cycle', () => {
    const { ws, goal, tasks, ids, clock } = sampleWorkspace({ chain: true });
    const q = bindQuestion(question('G8'), tasks[0]!.id);
    const r = applyAnswer(
      ws,
      q,
      { type: 'multiChoice', values: [tasks[1]!.id] },
      { goalId: goal.id, ids, clock },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]!.code).toBe('cycle');
  });

  it('fades prompts by scaffold level', () => {
    const q = question('G5');
    expect(promptFor(q, 1, { task: 'X' })).toEqual({
      prompt: 'How will you know “X” is done?',
      helper: q.helper,
    });
    expect(promptFor(q, 2, { task: 'X' })).toEqual({ prompt: 'Done when?', helper: undefined });
  });
});

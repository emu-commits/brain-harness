import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MemoryStorage, diffWorkspaces } from '../../src/data/storage';
import { exportWorkspace, importInto, parseImport } from '../../src/data/exportImport';
import { applyAnswer } from '../../src/core/questions/apply';
import { question } from '../../src/core/questions/bank';
import { bindQuestion } from '../../src/core/questions/bank';
import { emptyWorkspace } from '../../src/core/model/factories';
import { validateWorkspace } from '../../src/core/validation/validate';
import type { Workspace } from '../../src/core/model/types';
import type { Answer } from '../../src/core/questions/types';
import { sampleWorkspace, setup } from '../core/helpers';

/** Build a random but valid workspace by driving answers through applyAnswer. */
const wsArb = fc
  .record({
    title: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    tasks: fc.array(
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      { minLength: 1, maxLength: 6 },
    ),
    est: fc.array(fc.tuple(fc.nat(100), fc.nat(100), fc.nat(100)), { minLength: 6, maxLength: 6 }),
    minutes: fc.array(fc.nat(600), { minLength: 7, maxLength: 7 }),
    unicode: fc.string({ maxLength: 20 }),
  })
  .map((r) => {
    const { ids, clock } = setup();
    let ws: Workspace = emptyWorkspace();
    const step = (qid: string, a: Answer, bind?: string, goalId?: string) => {
      const q = bind ? bindQuestion(question(qid), bind) : question(qid);
      const res = applyAnswer(ws, q, a, { goalId, ids, clock });
      if (!res.ok) throw new Error(JSON.stringify(res.error));
      ws = res.value.ws;
      return res.value;
    };
    const g = step('C1', { type: 'text', value: r.title }).goalId;
    step('C4', { type: 'text', value: `why ${r.unicode}` }, undefined, g);
    const m = step('C7', { type: 'text', value: 'Milestone' }, undefined, g).created[0]!;
    const created = step('G3', { type: 'taskList', titles: r.tasks }, m, g).created;
    created.forEach((id, i) => {
      const [a, b, c] = [...r.est[i]!].sort((x, y) => x - y) as [number, number, number];
      step('G6', { type: 'range', value: { low: a, base: b, high: c } }, id, g);
    });
    step('G2', { type: 'capacity', minutesByWeekday: r.minutes as never }, undefined, g);
    return ws;
  });

describe('export / import', () => {
  it('round-trips to an identical model', async () => {
    await fc.assert(
      fc.asyncProperty(wsArb, async (ws) => {
        const text = await exportWorkspace(ws, [], '2026-01-05T00:00:00.000Z');
        const r = parseImport(text);
        return r.ok && JSON.stringify(r.value.ws) === JSON.stringify(ws);
      }),
      { numRuns: 100 },
    );
  });

  it('round-trips images', async () => {
    const { ws } = sampleWorkspace();
    const blob = new Blob([new Uint8Array([0, 1, 2, 250, 255])], { type: 'image/png' });
    const text = await exportWorkspace(ws, [{ id: 'img', type: 'image/png', blob }], 'x');
    const r = parseImport(text);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect([...new Uint8Array(await r.value.images[0]!.blob.arrayBuffer())]).toEqual([
        0, 1, 2, 250, 255,
      ]);
  });

  it('rejects invalid imports without writing anything', async () => {
    const { ws, tasks } = sampleWorkspace();
    const storage = new MemoryStorage(ws);
    const bad = {
      ...ws,
      dependencies: [{ id: 'd', fromTaskId: tasks[0]!.id, toTaskId: tasks[0]!.id, lagDays: 0 }],
    };
    const inputs = [
      'not json',
      '{"format":"something-else"}',
      JSON.stringify({
        format: 'goalgraph-export',
        schemaVersion: 1,
        data: { ...ws, tasks: 'nope' },
        images: [],
      }),
      JSON.stringify({ format: 'goalgraph-export', schemaVersion: 99, data: ws, images: [] }),
      await exportWorkspace(bad, [], 'x'),
    ];
    for (const text of inputs) {
      const r = await importInto(storage, text);
      expect(r.ok).toBe(false);
      expect(await storage.load()).toEqual(ws);
    }
  });

  it('never exports a running timer', async () => {
    const { ws } = sampleWorkspace();
    const w = {
      ...ws,
      settings: [
        {
          id: 'settings' as const,
          resumeThresholdDays: 3,
          maxGapsPerSession: 5,
          splitThresholdMinutes: 480,
          blockedAssumeDays: 7,
          stuck: { sessions: 3, overrunFactor: 1.5, blockedDays: 14 },
          calibration: { window: 10, minTasks: 5 },
          running: { taskId: 't', sessionId: 's', startedAt: 'x' },
        },
      ],
    };
    const r = parseImport(await exportWorkspace(w, [], 'x'));
    expect(r.ok && r.value.ws.settings[0]!.running).toBeUndefined();
  });
});

describe('migrations', () => {
  it('imports a schema-1 export (before check-ins existed)', async () => {
    const { ws } = sampleWorkspace();
    const v1 = { ...ws } as Record<string, unknown>;
    delete v1.checkins;
    const r = parseImport(
      JSON.stringify({
        format: 'goalgraph-export',
        schemaVersion: 1,
        exportedAt: 'x',
        data: v1,
        images: [],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ws.checkins).toEqual([]);
  });
});

describe('diffWorkspaces', () => {
  it('reports only changed rows', () => {
    const { ws, tasks } = sampleWorkspace();
    const next = { ...ws, tasks: [{ ...tasks[0]!, title: 'x' }] };
    expect(diffWorkspaces(ws, next)).toEqual([
      { table: 'tasks', puts: [next.tasks[0]], deletes: [tasks[1]!.id] },
    ]);
    expect(diffWorkspaces(ws, ws)).toEqual([]);
  });
  it('generated workspaces are valid', () => {
    fc.assert(
      fc.property(wsArb, (ws) => validateWorkspace(ws).length === 0),
      { numRuns: 50 },
    );
  });
});

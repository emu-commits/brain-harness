import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph, findCycles } from '../../src/core/engines/graph';
import type { ScheduleInput } from '../../src/core/engines/scheduler';
import { schedule } from '../../src/core/engines/scheduler';
import type { FinanceInput } from '../../src/core/engines/finance';
import { projectFinances } from '../../src/core/engines/finance';
import type { CalibrationSample } from '../../src/core/engines/calibration';
import { suggestMultiplier } from '../../src/core/engines/calibration';

// Language-agnostic fixtures: { description, inputs, expected }. Exact equality.

const root = join(__dirname, '../../fixtures');
function load(dir: string) {
  return readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      file: f,
      ...(JSON.parse(readFileSync(join(root, dir, f), 'utf8')) as {
        description: string;
        inputs: unknown;
        expected: unknown;
      }),
    }));
}

describe('fixtures/schedule', () => {
  for (const fx of load('schedule')) {
    it(`${fx.file}: ${fx.description}`, () => {
      const r = schedule(fx.inputs as ScheduleInput);
      if (!r.ok) {
        expect({ ok: false, error: r.error }).toEqual(fx.expected);
        return;
      }
      const tasks: Record<string, unknown> = {};
      for (const [id, t] of Object.entries(r.value.tasks)) {
        tasks[id] = {
          start: t.start,
          finish: t.finish,
          critical: t.critical,
          ...(t.assumedUnblock ? { assumedUnblock: true } : {}),
          ...(t.unestimated ? { unestimated: true } : {}),
        };
      }
      expect({
        ok: true,
        order: r.value.order,
        completion: r.value.completion,
        milestones: r.value.milestones,
        tasks,
      }).toEqual(fx.expected);
    });
  }
});

describe('fixtures/graph', () => {
  for (const fx of load('graph')) {
    it(`${fx.file}: ${fx.description}`, () => {
      const inp = fx.inputs as { nodes: { id: string; status?: string }[]; dependencies: never[] };
      const g = buildGraph(inp.nodes, inp.dependencies);
      const edges = g.nodes.flatMap((n) => g.succs.get(n)!.map((e) => [e.from, e.to, e.lagDays]));
      expect({ nodes: g.nodes, edges, cycles: findCycles(g) }).toEqual(fx.expected);
    });
  }
});

describe('fixtures/finance', () => {
  for (const fx of load('finance')) {
    it(`${fx.file}: ${fx.description}`, () => {
      const r = projectFinances(fx.inputs as FinanceInput);
      const { months, runwayExhaustedMonth, totalGoalCost } = r;
      expect({ months, runwayExhaustedMonth, totalGoalCost }).toEqual(fx.expected);
    });
  }
});

describe('fixtures/calibration', () => {
  for (const fx of load('calibration')) {
    it(`${fx.file}: ${fx.description}`, () => {
      const inp = fx.inputs as {
        samples: CalibrationSample[];
        category: string;
        window: number;
        minTasks: number;
      };
      const r = suggestMultiplier(inp.samples, inp.category, inp.window, inp.minTasks);
      expect(r ? { category: r.category, multiplier: r.multiplier, n: r.n } : null).toEqual(
        fx.expected,
      );
    });
  }
});

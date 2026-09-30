import type { ID } from '../model/types';
import type { Graph } from './graph';
import { topoSort } from './graph';

// Critical path method on calendar-day durations (SPEC §9.2). It identifies which chains
// drive the finish date and which tasks have slack; the scheduler produces actual dates.

export interface CpmNode {
  es: number;
  ef: number;
  ls: number;
  lf: number;
  float: number;
  critical: boolean;
}

export interface CpmInput {
  graph: Graph;
  /** Duration in calendar days per node. Missing = 0. */
  durations: ReadonlyMap<ID, number>;
  /** Completed tasks: finish day relative to today (≤ 0). Their duration is 0 and they are pinned. */
  pinnedFinish?: ReadonlyMap<ID, number>;
  /** Earliest allowed start, days relative to today. */
  minStart?: ReadonlyMap<ID, number>;
}

export const CRITICAL_FLOAT_EPSILON = 0.01;

export function computeCpm(input: CpmInput): { nodes: Map<ID, CpmNode>; projectEnd: number } {
  const { graph, durations, pinnedFinish, minStart } = input;
  const { order, cyclic } = topoSort(graph);
  if (cyclic.length) throw new Error(`computeCpm: graph has cycles (${cyclic.join(', ')})`);

  const es = new Map<ID, number>();
  const ef = new Map<ID, number>();
  for (const n of order) {
    const pinned = pinnedFinish?.get(n);
    if (pinned !== undefined) {
      es.set(n, pinned);
      ef.set(n, pinned);
      continue;
    }
    let start = Math.max(0, minStart?.get(n) ?? 0);
    for (const e of graph.preds.get(n) ?? []) start = Math.max(start, ef.get(e.from)! + e.lagDays);
    es.set(n, start);
    ef.set(n, start + (durations.get(n) ?? 0));
  }

  let projectEnd = 0;
  for (const n of order) projectEnd = Math.max(projectEnd, ef.get(n)!);

  const ls = new Map<ID, number>();
  const lf = new Map<ID, number>();
  for (const n of [...order].reverse()) {
    let finish = projectEnd;
    for (const e of graph.succs.get(n) ?? []) finish = Math.min(finish, ls.get(e.to)! - e.lagDays);
    const dur = pinnedFinish?.has(n) ? 0 : (durations.get(n) ?? 0);
    lf.set(n, finish);
    ls.set(n, finish - dur);
  }

  const nodes = new Map<ID, CpmNode>();
  for (const n of order) {
    const pinned = pinnedFinish?.has(n) ?? false;
    const float = ls.get(n)! - es.get(n)!;
    nodes.set(n, {
      es: es.get(n)!,
      ef: ef.get(n)!,
      ls: ls.get(n)!,
      lf: lf.get(n)!,
      float,
      // Completed tasks are history, not drivers of the remaining finish date.
      critical: !pinned && float <= CRITICAL_FLOAT_EPSILON,
    });
  }
  return { nodes, projectEnd };
}

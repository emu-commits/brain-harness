import type { Dependency, ID } from '../model/types';
import { cmp } from '../model/factories';

// Finish-to-start dependency graph (SPEC §9.1).

export interface Edge {
  from: ID;
  to: ID;
  lagDays: number;
}

export interface Graph {
  /** Node ids, sorted. */
  nodes: ID[];
  preds: Map<ID, Edge[]>;
  succs: Map<ID, Edge[]>;
}

export interface GraphNode {
  id: ID;
  status?: string;
}

/**
 * Build the graph. Dependencies that reference unknown nodes are ignored (callers validate
 * separately). Skipped tasks are removed and their dependents inherit their predecessors;
 * bridged lags add up, and when two paths join the larger lag wins.
 */
export function buildGraph(nodes: readonly GraphNode[], deps: readonly Dependency[]): Graph {
  const ids = new Set(nodes.map((n) => n.id));
  const skipped = new Set(nodes.filter((n) => n.status === 'skipped').map((n) => n.id));

  // Edge map keyed by from→to, keeping the max lag for duplicates.
  const edges = new Map<string, Edge>();
  const add = (e: Edge) => {
    if (e.from === e.to) return;
    const k = `${e.from}\u0000${e.to}`;
    const prev = edges.get(k);
    if (!prev || prev.lagDays < e.lagDays) edges.set(k, e);
  };
  for (const d of deps) {
    if (ids.has(d.fromTaskId) && ids.has(d.toTaskId)) {
      add({ from: d.fromTaskId, to: d.toTaskId, lagDays: d.lagDays });
    }
  }

  // Bridge skipped nodes one at a time, in id order, for determinism.
  for (const s of [...skipped].sort(cmp)) {
    const all = [...edges.values()];
    const ins = all.filter((e) => e.to === s);
    const outs = all.filter((e) => e.from === s);
    for (const e of [...ins, ...outs]) edges.delete(`${e.from}\u0000${e.to}`);
    for (const i of ins)
      for (const o of outs) add({ from: i.from, to: o.to, lagDays: i.lagDays + o.lagDays });
  }

  const kept = [...ids].filter((id) => !skipped.has(id)).sort(cmp);
  const preds = new Map<ID, Edge[]>(kept.map((id) => [id, []]));
  const succs = new Map<ID, Edge[]>(kept.map((id) => [id, []]));
  const sorted = [...edges.values()].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
  for (const e of sorted) {
    preds.get(e.to)?.push(e);
    succs.get(e.from)?.push(e);
  }
  return { nodes: kept, preds, succs };
}

/** Kahn's algorithm. On a cycle, `cyclic` holds the exact members (via Tarjan SCC). */
export function topoSort(g: Graph): { order: ID[]; cyclic: ID[] } {
  const indeg = new Map<ID, number>();
  for (const n of g.nodes) indeg.set(n, g.preds.get(n)?.length ?? 0);
  const ready = g.nodes.filter((n) => indeg.get(n) === 0);
  const order: ID[] = [];
  while (ready.length) {
    ready.sort(cmp);
    const n = ready.shift()!;
    order.push(n);
    for (const e of g.succs.get(n) ?? []) {
      const d = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, d);
      if (d === 0) ready.push(e.to);
    }
  }
  if (order.length === g.nodes.length) return { order, cyclic: [] };
  return { order, cyclic: findCycles(g).flat().sort(cmp) };
}

/** Tarjan's strongly connected components; returns components that form cycles. */
export function findCycles(g: Graph): ID[][] {
  let index = 0;
  const idx = new Map<ID, number>();
  const low = new Map<ID, number>();
  const onStack = new Set<ID>();
  const stack: ID[] = [];
  const out: ID[][] = [];

  const strong = (v: ID) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const e of g.succs.get(v) ?? []) {
      if (!idx.has(e.to)) {
        strong(e.to);
        low.set(v, Math.min(low.get(v)!, low.get(e.to)!));
      } else if (onStack.has(e.to)) {
        low.set(v, Math.min(low.get(v)!, idx.get(e.to)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: ID[] = [];
      let w: ID;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.sort(cmp));
    }
  };

  for (const n of g.nodes) if (!idx.has(n)) strong(n);
  return out.sort((a, b) => cmp(a[0]!, b[0]!));
}

/**
 * Would adding from→to create a cycle? Returns the path to→…→from that closes the loop
 * (so the UI can name the tasks), or null when the edge is safe.
 */
export function cyclePathIfAdded(
  nodes: readonly GraphNode[],
  deps: readonly Dependency[],
  from: ID,
  to: ID,
): ID[] | null {
  if (from === to) return [from];
  // Cycle checks ignore skipping: a dependency is structural even on a skipped task.
  const g = buildGraph(
    nodes.map((n) => ({ id: n.id })),
    deps,
  );
  // DFS from `to` looking for `from`.
  const prev = new Map<ID, ID>();
  const seen = new Set<ID>([to]);
  const queue: ID[] = [to];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === from) {
      const path = [from];
      let cur = from;
      while (cur !== to) {
        cur = prev.get(cur)!;
        path.unshift(cur);
      }
      return path;
    }
    for (const e of g.succs.get(n) ?? []) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        prev.set(e.to, n);
        queue.push(e.to);
      }
    }
  }
  return null;
}

/** All transitive successors of a node. */
export function descendants(g: Graph, id: ID): Set<ID> {
  const out = new Set<ID>();
  const stack = [...(g.succs.get(id) ?? []).map((e) => e.to)];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    for (const e of g.succs.get(n) ?? []) stack.push(e.to);
  }
  return out;
}

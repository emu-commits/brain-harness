import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dagre from '@dagrejs/dagre';
import { useStore } from '../../store';
import { useForecast, useStuck } from '../../derived';
import type { Dependency, ID, Milestone, Task } from '../../../core/model/types';
import { milestonesOfGoal, tasksOfGoal } from '../../../core/model/factories';
import { readyTaskIds } from '../../../core/engines/nextAction';
import { TaskEditor } from './TaskEditor';
import { STATE_LABEL, taskState } from './ListView';
import type { TaskState } from './ListView';
import { fmtDate, fmtMinutesRange } from '../../format';

const NODE_W = 176;
const NODE_H = 54;
const LABEL_H = 26;

interface LNode {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  task?: Task;
  milestone?: Milestone;
  count?: number;
}
interface LEdge {
  from: string;
  to: string;
  points: { x: number; y: number }[];
}
interface LCluster {
  milestone: Milestone;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Layout {
  nodes: LNode[];
  edges: LEdge[];
  clusters: LCluster[];
  width: number;
  height: number;
}

function computeLayout(
  tasks: Task[],
  deps: Dependency[],
  milestones: Milestone[],
  collapsed: Set<ID>,
): Layout {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({
    rankdir: 'LR',
    nodesep: 22,
    ranksep: 64,
    edgesep: 12,
    marginx: 24,
    marginy: 24 + LABEL_H,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const keyOf = new Map<ID, string>();
  for (const m of milestones) {
    const mt = tasks.filter((t) => t.milestoneId === m.id);
    if (!mt.length) continue;
    if (collapsed.has(m.id)) g.setNode(`m:${m.id}`, { width: NODE_W, height: NODE_H });
    else g.setNode(`c:${m.id}`, {});
  }
  for (const t of tasks) {
    if (t.milestoneId && collapsed.has(t.milestoneId)) {
      keyOf.set(t.id, `m:${t.milestoneId}`);
      continue;
    }
    g.setNode(t.id, { width: NODE_W, height: NODE_H });
    keyOf.set(t.id, t.id);
    if (t.milestoneId && g.hasNode(`c:${t.milestoneId}`)) g.setParent(t.id, `c:${t.milestoneId}`);
  }
  for (const d of deps) {
    const a = keyOf.get(d.fromTaskId);
    const b = keyOf.get(d.toTaskId);
    if (a && b && a !== b) g.setEdge(a, b);
  }
  dagre.layout(g);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const msById = new Map(milestones.map((m) => [m.id, m]));
  const nodes: LNode[] = [];
  const clusters: LCluster[] = [];
  for (const k of g.nodes()) {
    const n = g.node(k) as { x: number; y: number; width: number; height: number };
    if (k.startsWith('c:')) {
      const m = msById.get(k.slice(2))!;
      clusters.push({
        milestone: m,
        x: n.x - n.width / 2,
        y: n.y - n.height / 2 - LABEL_H,
        w: n.width,
        h: n.height + LABEL_H,
      });
    } else if (k.startsWith('m:')) {
      const m = msById.get(k.slice(2))!;
      nodes.push({
        key: k,
        x: n.x - n.width / 2,
        y: n.y - n.height / 2,
        w: n.width,
        h: n.height,
        milestone: m,
        count: tasks.filter((t) => t.milestoneId === m.id).length,
      });
    } else {
      nodes.push({
        key: k,
        x: n.x - n.width / 2,
        y: n.y - n.height / 2,
        w: n.width,
        h: n.height,
        task: byId.get(k),
      });
    }
  }
  const edges: LEdge[] = g
    .edges()
    .map((e) => ({
      from: e.v,
      to: e.w,
      points: (g.edge(e) as { points: { x: number; y: number }[] }).points,
    }));
  const gg = g.graph() as { width?: number; height?: number };
  return { nodes, edges, clusters, width: gg.width ?? 0, height: gg.height ?? 0 };
}

function wrap(s: string, max: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1]!;
    if ((cur + ' ' + w).trim().length <= max) lines[lines.length - 1] = (cur + ' ' + w).trim();
    else lines.push(w);
  }
  if (lines.length > 2) return [lines[0]!, `${lines[1]!.slice(0, max - 1)}…`];
  return lines.map((l) => (l.length > max ? `${l.slice(0, max - 1)}…` : l));
}

function pathOf(points: { x: number; y: number }[]): string {
  if (!points.length) return '';
  let d = `M${points[0]!.x},${points[0]!.y}`;
  if (points.length === 2) return `${d} L${points[1]!.x},${points[1]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const n = points[i + 1]!;
    const mx = (p.x + n.x) / 2;
    const my = (p.y + n.y) / 2;
    d += ` Q${p.x},${p.y} ${i === points.length - 2 ? `${n.x},${n.y}` : `${mx},${my}`}`;
  }
  return d;
}

export function GraphView({ editable }: { editable: boolean }) {
  const { ws, goal, clock } = useStore();
  const { forecast } = useForecast();
  const stuck = useStuck();
  const [collapsed, setCollapsed] = useState<Set<ID>>(new Set());
  const [showCritical, setShowCritical] = useState(true);
  const [focus, setFocus] = useState<ID | null>(null);
  const [editing, setEditing] = useState<ID | null>(null);
  const tasks = useMemo(
    () => (goal ? tasksOfGoal(ws, goal.id).filter((t) => t.status !== 'skipped') : []),
    [ws, goal],
  );
  const milestones = useMemo(() => (goal ? milestonesOfGoal(ws, goal.id) : []), [ws, goal]);
  const deps = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    return ws.dependencies.filter((d) => ids.has(d.fromTaskId) && ids.has(d.toTaskId));
  }, [ws.dependencies, tasks]);
  const structure = JSON.stringify([
    tasks.map((t) => [t.id, t.milestoneId]),
    deps.map((d) => [d.fromTaskId, d.toTaskId]),
    milestones.map((m) => m.id),
    [...collapsed],
  ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(tasks, deps, milestones, collapsed), [structure]);
  const ready = useMemo(() => readyTaskIds(tasks, deps, clock.today()), [tasks, deps, clock]);
  const sched = forecast?.base.schedule;
  const isCrit = (id: ID) => !!sched?.tasks[id]?.critical;

  const neighbors = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const d of deps) {
      if (d.fromTaskId === focus) s.add(d.toTaskId);
      if (d.toTaskId === focus) s.add(d.fromTaskId);
    }
    return s;
  }, [focus, deps]);

  const clearFocus = useCallback(() => setFocus(null), []);
  const { svgRef, view, setView, fit } = usePanZoom(layout.width, layout.height, clearFocus);

  if (!goal) return null;
  if (!tasks.length)
    return (
      <p className="muted">No tasks yet. Add some in the list, or answer the open questions.</p>
    );

  const critPath = sched
    ? (sched.order
        .filter((id) => isCrit(id))
        .map((id) => ws.tasks.find((t) => t.id === id)?.title)
        .filter(Boolean) as string[])
    : [];
  const focused = focus ? ws.tasks.find((t) => t.id === focus) : undefined;
  const stateOf = (t: Task): TaskState => taskState(t, ready);

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <label className="toggle">
          <input
            type="checkbox"
            checked={showCritical}
            onChange={(e) => setShowCritical(e.target.checked)}
          />{' '}
          Critical path
        </label>
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn"
          aria-label="Zoom out"
          onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.25) }))}
        >
          −
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Zoom in"
          onClick={() => setView((v) => ({ ...v, k: Math.min(3, v.k * 1.25) }))}
        >
          +
        </button>
        <button type="button" className="btn small" onClick={fit}>
          Fit
        </button>
      </div>
      <div className="graph-wrap">
        <svg
          ref={svgRef}
          className="graph"
          aria-label={`Dependency graph: ${tasks.length} tasks in ${milestones.length} milestones. The list view has the same content.`}
          role="group"
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className="arrow-head" />
            </marker>
            <marker
              id="arrow-crit"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className="arrow-head crit" />
            </marker>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {layout.clusters.map((c) => (
              <g key={c.milestone.id} className="cluster">
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={12} />
                <g
                  className="cluster-label"
                  role="button"
                  tabIndex={0}
                  aria-label={`Collapse milestone ${c.milestone.title}`}
                  onClick={() => setCollapsed(new Set([...collapsed, c.milestone.id]))}
                  onKeyDown={(e) =>
                    (e.key === 'Enter' || e.key === ' ') &&
                    setCollapsed(new Set([...collapsed, c.milestone.id]))
                  }
                >
                  <text x={c.x + 12} y={c.y + 18}>
                    ▾{' '}
                    {c.milestone.title.length > 40
                      ? `${c.milestone.title.slice(0, 39)}…`
                      : c.milestone.title}
                  </text>
                </g>
              </g>
            ))}
            {layout.edges.map((e) => {
              const crit = showCritical && isCrit(e.from) && isCrit(e.to);
              const dim = neighbors && !(neighbors.has(e.from) && neighbors.has(e.to));
              return (
                <path
                  key={`${e.from}>${e.to}`}
                  d={pathOf(e.points)}
                  className={`edge${crit ? ' crit' : ''}${dim ? ' dim' : ''}`}
                  markerEnd={`url(#${crit ? 'arrow-crit' : 'arrow'})`}
                />
              );
            })}
            {layout.nodes.map((n) => {
              if (n.milestone) {
                const m = n.milestone;
                return (
                  <g
                    key={n.key}
                    className="node collapsed"
                    role="button"
                    tabIndex={0}
                    aria-label={`Expand milestone ${m.title}, ${n.count} tasks`}
                    onClick={() => setCollapsed(new Set([...collapsed].filter((x) => x !== m.id)))}
                    onKeyDown={(e) =>
                      (e.key === 'Enter' || e.key === ' ') &&
                      setCollapsed(new Set([...collapsed].filter((x) => x !== m.id)))
                    }
                  >
                    <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} />
                    <text x={n.x + 12} y={n.y + 22} className="node-title">
                      ▸ {wrap(m.title, 22)[0]}
                    </text>
                    <text x={n.x + 12} y={n.y + 40} className="node-sub">
                      {n.count} tasks · {fmtDate(sched?.milestones[m.id] ?? null)}
                    </text>
                  </g>
                );
              }
              const t = n.task!;
              const st = stateOf(t);
              const crit = showCritical && isCrit(t.id) && st !== 'completed';
              const dim = neighbors && !neighbors.has(t.id);
              const lines = wrap(t.title, 24);
              return (
                <g
                  key={n.key}
                  className={`node st-${st}${crit ? ' crit' : ''}${stuck[t.id] ? ' stuck' : ''}${dim ? ' dim' : ''}${focus === t.id ? ' focused' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${t.title}: ${STATE_LABEL[st]}${crit ? ', critical' : ''}${stuck[t.id] ? ', stuck' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocus(focus === t.id ? null : t.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setFocus(focus === t.id ? null : t.id);
                    }
                  }}
                >
                  <title>{t.title}</title>
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} />
                  <rect x={n.x} y={n.y} width={5} height={n.h} rx={2} className="node-bar" />
                  {lines.map((l, i) => (
                    <text
                      key={i}
                      x={n.x + 14}
                      y={n.y + (lines.length === 1 ? 24 : 20) + i * 15}
                      className="node-title"
                    >
                      {l}
                    </text>
                  ))}
                  <text x={n.x + 14} y={n.y + n.h - 9} className="node-sub">
                    {t.kind === 'wait'
                      ? `wait ${t.waitDays?.base ?? '?'} d`
                      : fmtMinutesRange(t.estimateMinutes)}
                    {sched?.tasks[t.id] && st !== 'completed'
                      ? ` · ${fmtDate(sched.tasks[t.id]!.finish).replace(/, \d{4}$/, '')}`
                      : ''}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <ul className="legend" aria-label="Legend">
        {(['completed', 'ready', 'inProgress', 'blocked', 'future'] as TaskState[]).map((s) => (
          <li key={s}>
            <span className={`dot st-${s}`} aria-hidden="true" />
            {STATE_LABEL[s]}
          </li>
        ))}
        <li>
          <span className="dot stuck-dot" aria-hidden="true" />
          Stuck
        </li>
        <li>
          <span className="crit-swatch" aria-hidden="true" />
          Critical
        </li>
      </ul>
      {focused ? (
        <section className="card focus-card" aria-live="polite">
          <p className="eyebrow">{STATE_LABEL[stateOf(focused)]}</p>
          <h3>{focused.title}</h3>
          <p className="muted small">
            {focused.kind === 'wait' ? 'Wait' : fmtMinutesRange(focused.estimateMinutes)}
            {sched?.tasks[focused.id] &&
              ` · finishes ${fmtDate(sched.tasks[focused.id]!.finish)} (base)`}
            {sched?.tasks[focused.id] &&
              (sched.tasks[focused.id]!.critical
                ? ' · critical'
                : ` · ${Math.round(sched.tasks[focused.id]!.float)} days of slack`)}
          </p>
          {focused.definitionOfDone && <p>Done when: {focused.definitionOfDone}</p>}
          <button type="button" className="btn small" onClick={() => setEditing(focused.id)}>
            {editable ? 'Edit' : 'Details'}
          </button>
        </section>
      ) : (
        <p className="muted small graph-summary">
          {critPath.length
            ? `Critical path: ${critPath.join(' → ')}.`
            : 'No critical path yet — add estimates and weekly hours.'}{' '}
          Tap a task to focus it and its neighbors; tap a milestone label to collapse it.
        </p>
      )}
      {editing && (
        <TaskEditor taskId={editing} editable={editable} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Pointer + wheel + pinch pan/zoom for an SVG. */
function usePanZoom(width: number, height: number, onBackgroundTap: () => void) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el || !width || !height) return;
    const r = el.getBoundingClientRect();
    // Keep labels legible: never shrink below 0.65; wide graphs start at the left and pan.
    const k = Math.max(0.65, Math.min(1.1, (r.width - 16) / width, (r.height - 16) / height));
    setView({
      k,
      x: width * k < r.width ? (r.width - width * k) / 2 : 8,
      y: Math.max(8, (r.height - height * k) / 2),
    });
  }, [width, height]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const k = Math.max(0.2, Math.min(3, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest('.node, .cluster-label')) return;
      el.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved.current = 0;
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const pts = [...pointers.current.entries()];
      if (pts.length === 1) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        moved.current += Math.abs(dx) + Math.abs(dy);
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      } else if (pts.length === 2) {
        const other = pts.find(([id]) => id !== e.pointerId)![1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        const r = el.getBoundingClientRect();
        const cx = (e.clientX + other.x) / 2 - r.left;
        const cy = (e.clientY + other.y) / 2 - r.top;
        moved.current += 10;
        setView((v) => {
          const k = Math.max(0.2, Math.min(3, v.k * (d1 / Math.max(d0, 1))));
          return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
        });
      }
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onUp = (e: PointerEvent) => {
      if (pointers.current.has(e.pointerId) && pointers.current.size === 1 && moved.current < 4)
        onBackgroundTap();
      pointers.current.delete(e.pointerId);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [onBackgroundTap, width]);

  return { svgRef, view, setView, fit };
}

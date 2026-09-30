import type { ID, ISODate, ISOTime, Workspace } from '../model/types';
import { cmp, loggedCostByTask, loggedMinutesByTask } from '../model/factories';

// Reforecast triggers (SPEC §9.9). They produce prompts; they never reforecast silently.

export type Trigger =
  | { kind: 'taskOverrun'; taskId: ID; actualMinutes: number; baseMinutes: number }
  | { kind: 'costOverrun'; taskId: ID; actualCents: number; baseCents: number }
  | { kind: 'criticalLate'; taskId: ID; scheduledFinish: ISODate; actualFinish: ISODate }
  | { kind: 'assumptionChanged'; assumptionId: ID; status: 'contradicted' | 'revised' }
  | { kind: 'unplannedChange'; taskId: ID }
  | { kind: 'revenueVariance'; month: string; recordedCents: number; modeledCents: number };

export interface TriggerThresholds {
  taskOverrun: number;
  costOverrun: number;
  revenueVariance: number;
}

export const DEFAULT_TRIGGER_THRESHOLDS: TriggerThresholds = {
  taskOverrun: 1.25,
  costOverrun: 1.15,
  revenueVariance: 0.2,
};

export interface TriggerInput {
  ws: Workspace;
  goalId: ID;
  /** Only events after this time count (usually the latest snapshot). */
  since?: ISOTime;
  /** The latest snapshot's base schedule: scheduled finish and critical flag per task. */
  baseline?: Record<ID, { finish: ISODate; critical: boolean }>;
  /** Revenue the user recorded, per month, vs the modeled base revenue. */
  revenue?: { month: string; recordedCents: number; modeledCents: number }[];
  thresholds?: TriggerThresholds;
}

export function evaluateTriggers(input: TriggerInput): Trigger[] {
  const { ws, goalId, since, baseline } = input;
  const th = input.thresholds ?? DEFAULT_TRIGGER_THRESHOLDS;
  const after = (t?: ISOTime) => !!t && (!since || t > since);
  const minutes = loggedMinutesByTask(ws);
  const costs = loggedCostByTask(ws);
  const out: Trigger[] = [];

  const tasks = ws.tasks.filter((t) => t.goalId === goalId).sort((a, b) => cmp(a.id, b.id));
  for (const t of tasks) {
    if (t.status === 'completed' && after(t.completedAt)) {
      const base = t.estimateMinutes?.base ?? 0;
      const actual = minutes[t.id] ?? 0;
      if (t.kind !== 'wait' && base > 0 && actual > base * th.taskOverrun) {
        out.push({ kind: 'taskOverrun', taskId: t.id, actualMinutes: actual, baseMinutes: base });
      }
      const baseCost = t.cost?.base ?? 0;
      const actualCost = costs[t.id] ?? 0;
      if (baseCost > 0 && actualCost > baseCost * th.costOverrun) {
        out.push({
          kind: 'costOverrun',
          taskId: t.id,
          actualCents: actualCost,
          baseCents: baseCost,
        });
      }
      const b = baseline?.[t.id];
      const done = t.completedAt!.slice(0, 10);
      if (b && b.critical && done > b.finish) {
        out.push({
          kind: 'criticalLate',
          taskId: t.id,
          scheduledFinish: b.finish,
          actualFinish: done,
        });
      }
    }
    if (t.addedOutsidePlan && after(t.createdAt))
      out.push({ kind: 'unplannedChange', taskId: t.id });
  }

  const assumptions = ws.assumptions
    .filter((a) => a.goalId === goalId)
    .sort((a, b) => cmp(a.id, b.id));
  for (const a of assumptions) {
    if (
      (a.status === 'contradicted' || a.status === 'revised') &&
      a.history.some((h) => after(h.at) && h.status === a.status)
    ) {
      out.push({ kind: 'assumptionChanged', assumptionId: a.id, status: a.status });
    }
  }

  for (const r of input.revenue ?? []) {
    if (
      r.modeledCents > 0 &&
      Math.abs(r.recordedCents - r.modeledCents) / r.modeledCents > th.revenueVariance
    ) {
      out.push({ kind: 'revenueVariance', ...r });
    }
  }
  return out;
}

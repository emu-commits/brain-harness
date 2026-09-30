import type { CalibrationDecision, ID, ISOTime, Prediction, Workspace } from '../model/types';
import { cmp, loggedMinutesByTask } from '../model/factories';
import { diffDays } from '../util/dates';
import { median, round } from '../util/stats';

// Calibration: the user's own predictions vs actuals (SPEC §9.6).

export interface CalibrationSample {
  taskId: ID;
  category?: string;
  estimateBase: number;
  actualMinutes: number;
  completedAt: ISOTime;
}

export interface Suggestion {
  /** Category the multiplier applies to, or '*' for all tasks. */
  category: string;
  multiplier: number;
  n: number;
  ratios: number[];
}

/** Completed work/decision tasks with a positive base estimate and positive logged time. */
export function calibrationSamples(ws: Workspace, goalId: ID): CalibrationSample[] {
  const logged = loggedMinutesByTask(ws);
  const out: CalibrationSample[] = [];
  for (const t of ws.tasks) {
    if (t.goalId !== goalId || t.status !== 'completed' || t.kind === 'wait') continue;
    const base = t.estimateMinutes?.base ?? 0;
    const actual = logged[t.id] ?? 0;
    if (base > 0 && actual > 0 && t.completedAt) {
      out.push({
        taskId: t.id,
        category: t.category,
        estimateBase: base,
        actualMinutes: actual,
        completedAt: t.completedAt,
      });
    }
  }
  return out;
}

function mostRecent(samples: readonly CalibrationSample[], n: number): CalibrationSample[] {
  return [...samples]
    .sort((a, b) => cmp(b.completedAt, a.completedAt) || cmp(a.taskId, b.taskId))
    .slice(0, n);
}

function geoMedian(samples: readonly CalibrationSample[]): {
  multiplier: number;
  ratios: number[];
} {
  const ratios = samples.map((s) => s.actualMinutes / s.estimateBase);
  return {
    multiplier: round(Math.exp(median(ratios.map(Math.log))), 4),
    ratios: ratios.map((r) => round(r, 4)),
  };
}

/**
 * suggested(category) = exp(median(ln(actual / estimate.base))) over the most recent `window`
 * tasks in the category. Needs ≥ minTasks; else falls back to all categories ('*'); else null.
 */
export function suggestMultiplier(
  samples: readonly CalibrationSample[],
  category: string | undefined,
  window: number,
  minTasks: number,
): Suggestion | null {
  if (category !== undefined) {
    const inCat = mostRecent(
      samples.filter((s) => s.category === category),
      window,
    );
    if (inCat.length >= minTasks) return { category, n: inCat.length, ...geoMedian(inCat) };
  }
  const all = mostRecent(samples, window);
  if (all.length >= minTasks) return { category: '*', n: all.length, ...geoMedian(all) };
  return null;
}

/** Every category (plus '*') that has a suggestion, sorted by category. */
export function allSuggestions(
  samples: readonly CalibrationSample[],
  window: number,
  minTasks: number,
): Suggestion[] {
  const cats = [...new Set(samples.map((s) => s.category).filter((c): c is string => !!c))].sort(
    cmp,
  );
  const out: Suggestion[] = [];
  for (const c of cats) {
    const s = suggestMultiplier(samples, c, window, minTasks);
    if (s && s.category === c) out.push(s);
  }
  const star = suggestMultiplier(samples, undefined, window, minTasks);
  if (star) out.push(star);
  return out;
}

/** The latest accepted multiplier per category. */
export function acceptedCalibration(
  decisions: readonly CalibrationDecision[],
): Record<string, number> {
  const latest = new Map<string, CalibrationDecision>();
  for (const d of decisions) {
    const prev = latest.get(d.category);
    if (
      !prev ||
      cmp(prev.acceptedAt, d.acceptedAt) < 0 ||
      (prev.acceptedAt === d.acceptedAt && cmp(prev.id, d.id) < 0)
    ) {
      latest.set(d.category, d);
    }
  }
  const out: Record<string, number> = {};
  for (const k of [...latest.keys()].sort(cmp)) out[k] = latest.get(k)!.multiplier;
  return out;
}

export interface DateError {
  predictionId: ID;
  createdAt: ISOTime;
  /** realized − predicted, in days. Positive = finished later than guessed. */
  errorDays: number;
}

/** Forecasting skill: errors for date predictions that have a realized value. */
export function dateErrors(predictions: readonly Prediction[]): DateError[] {
  return predictions
    .filter(
      (p) =>
        (p.subject === 'goalDate' || p.subject === 'milestoneDate') &&
        typeof p.predicted === 'string' &&
        typeof p.realized === 'string',
    )
    .map((p) => ({
      predictionId: p.id,
      createdAt: p.createdAt,
      errorDays: diffDays(p.predicted as string, p.realized as string),
    }))
    .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.predictionId, b.predictionId));
}

export function medianAbsError(errors: readonly DateError[]): number | null {
  return errors.length ? median(errors.map((e) => Math.abs(e.errorDays))) : null;
}

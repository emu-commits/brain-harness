import type { CheckIn, Goal, ID, ISODate, ISOTime, Workspace } from '../model/types';
import { cmp, getSettings } from '../model/factories';
import { daysBetweenTimes } from '../util/dates';

// WOOP as a practice, not a form (Oettingen): the wish, outcome, obstacle and plan are rehearsed
// at the start of a session every few days, and the user's own if-then is shown back at the
// moments it was written for. Everything here only *decides when* to ask; the words are the user's.

export const DEFAULT_WOOP_EVERY_DAYS = 3;
/** A pause counts as an early stop when the sitting ran under this share of the prediction. */
export const EARLY_STOP_FRACTION = 0.5;

export interface IfThen {
  when: string;
  then: string;
}

/**
 * Split "When X, I will Y" (or "If X, then Y", "When X I'll Y") into its parts for display.
 * Returns null when the text doesn't follow that shape; callers then show it verbatim.
 */
export function parseIfThen(text: string): IfThen | null {
  const t = text.trim().replace(/[.\s]+$/, '');
  const m =
    /^(?:when|if|whenever)\s+(.+?)(?:,\s*|\s+)(?:then\s+)?(?:i\s+will|i[’']ll)\s+(.+)$/i.exec(t) ??
    /^(?:when|if|whenever)\s+(.+?),\s*then\s+(.+)$/i.exec(t);
  if (!m || !m[1]!.trim() || !m[2]!.trim()) return null;
  return { when: m[1]!.trim(), then: m[2]!.trim() };
}

export function checkInsOf(ws: Workspace, goalId: ID, kind?: CheckIn['kind']): CheckIn[] {
  return ws.checkins
    .filter((c) => c.goalId === goalId && (!kind || c.kind === kind))
    .sort((a, b) => cmp(a.at, b.at) || cmp(a.id, b.id));
}

function hasWoopMaterial(goal: Goal): boolean {
  return !!(goal.charter.why.trim() || goal.charter.obstaclePlan.trim());
}

/**
 * Is the session-start WOOP ritual due? Every `woopEveryDays` days (default 3; 0 turns it off),
 * counting skipped rituals too, so a skip quiets it for the same interval. Not on every session:
 * a ritual seen every time stops being read.
 */
export function woopDue(ws: Workspace, goalId: ID, now: ISOTime): boolean {
  const goal = ws.goals.find((g) => g.id === goalId);
  if (!goal || !hasWoopMaterial(goal)) return false;
  const every = getSettings(ws).woopEveryDays ?? DEFAULT_WOOP_EVERY_DAYS;
  if (every <= 0) return false;
  const last = checkInsOf(ws, goalId, 'woop').at(-1);
  // The charter was just written in the first run; don't re-ask on the very first day.
  const since = last?.at ?? goal.createdAt;
  return daysBetweenTimes(since, now) >= (last ? every : 1);
}

/** Today's if-then from a WOOP check-in made today, if any. */
export function todaysPlan(
  ws: Workspace,
  goalId: ID,
  today: ISODate,
): { obstacle: string; plan: string } | null {
  const c = checkInsOf(ws, goalId, 'woop')
    .filter((x) => x.day === today && x.todayPlan?.trim())
    .at(-1);
  return c ? { obstacle: c.obstacleToday?.trim() ?? '', plan: c.todayPlan!.trim() } : null;
}

/** A revised if-then from a check-in, waiting to be applied in a Plan session. */
export function pendingRevision(ws: Workspace, goalId: ID): CheckIn | null {
  return (
    checkInsOf(ws, goalId, 'woop')
      .filter((c) => c.revisedPlan?.trim() && c.revisedPlanStatus === 'pending')
      .at(-1) ?? null
  );
}

export function isEarlyStop(minutes: number, predicted: number | undefined | null): boolean {
  return !!predicted && predicted > 0 && minutes < predicted * EARLY_STOP_FRACTION;
}

/**
 * Should an obstacle moment be offered? Only when there is a plan to show, and at most once per
 * session, so it stays a prompt rather than a nag.
 */
export function obstacleMomentAvailable(
  ws: Workspace,
  goalId: ID,
  sessionId: ID | undefined,
): boolean {
  const goal = ws.goals.find((g) => g.id === goalId);
  if (!goal?.charter.obstaclePlan.trim()) return false;
  if (!sessionId) return true;
  return !ws.checkins.some((c) => c.kind === 'obstacleMoment' && c.sessionId === sessionId);
}

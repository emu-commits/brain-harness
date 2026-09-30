import type { Goal, ID, ISOTime, Session, Task, Workspace } from '../model/types';
import { getSettings } from '../model/factories';
import { daysBetweenTimes } from '../util/dates';
import { lastEndedSession, sessionsOfGoal } from './sessions';
import { cmp } from '../model/factories';

// Hooks (SPEC §5.2): deterministic handlers that return prompts for the UI to show.

/** "Why · When ___, I will ___" — shown at the start of every session. */
export function charterLine(goal: Goal): string | null {
  const parts = [goal.charter.why.trim(), goal.charter.obstaclePlan.trim()].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The latest handoff note written for this goal. */
export function lastHandoff(
  ws: Workspace,
  goalId: ID,
): { note: string; sessionId: ID; at: ISOTime } | null {
  const withNote = sessionsOfGoal(ws, goalId)
    .filter((s) => s.handoffNote?.trim() && s.endedAt)
    .sort((a, b) => cmp(b.endedAt!, a.endedAt!));
  const s = withNote[0];
  return s ? { note: s.handoffNote!, sessionId: s.id, at: s.endedAt! } : null;
}

export interface SessionStartPrompt {
  charterLine: string | null;
  /** Present when the user has been away ≥ resumeThresholdDays: show the handoff first. */
  resume: { handoffNote: string | null; lastSessionId: ID; daysAway: number } | null;
  reviewDue: boolean;
}

export function sessionStartHook(ws: Workspace, goalId: ID, now: ISOTime): SessionStartPrompt {
  const goal = ws.goals.find((g) => g.id === goalId);
  if (!goal) throw new Error(`sessionStartHook: unknown goal ${goalId}`);
  const settings = getSettings(ws);
  const last = lastEndedSession(ws, goalId);
  let resume: SessionStartPrompt['resume'] = null;
  if (last?.endedAt) {
    const daysAway = daysBetweenTimes(last.endedAt, now);
    if (daysAway >= settings.resumeThresholdDays) {
      resume = {
        handoffNote: lastHandoff(ws, goalId)?.note ?? null,
        lastSessionId: last.id,
        daysAway,
      };
    }
  }
  return { charterLine: charterLine(goal), resume, reviewDue: weeklyHook(ws, goalId, now) };
}

/** Weekly: 7 days since the last Review (or since the goal was created). */
export function weeklyHook(ws: Workspace, goalId: ID, now: ISOTime): boolean {
  const goal = ws.goals.find((g) => g.id === goalId);
  if (!goal) return false;
  const reviews = sessionsOfGoal(ws, goalId).filter((s) => s.mode === 'review' && s.endedAt);
  const since = reviews.length ? reviews[reviews.length - 1]!.endedAt! : goal.createdAt;
  return daysBetweenTimes(since, now) >= 7;
}

export interface PreTaskPrompt {
  /** Always required: confirm (or write) the definition of done. */
  definitionOfDone: string;
  /** Default for "predict time for this sitting" (optional). */
  predictedMinutesDefault: number | null;
  /** Ask "When and where will you do this?" when no intention is set. */
  askIntention: boolean;
}

export function preTaskHook(task: Task): PreTaskPrompt {
  return {
    definitionOfDone: task.definitionOfDone,
    predictedMinutesDefault: task.estimateMinutes?.base ?? null,
    askIntention: !task.intention || (!task.intention.when.trim() && !task.intention.where.trim()),
  };
}

export interface PostTaskPrompt {
  prefillMinutes: number | null;
  askCost: boolean;
  askEvidence: true;
  askSurprise: true;
}

export function postTaskHook(task: Task, startedAt: ISOTime | null, now: ISOTime): PostTaskPrompt {
  const prefill = startedAt
    ? Math.max(1, Math.round((Date.parse(now) - Date.parse(startedAt)) / 60000))
    : null;
  return {
    prefillMinutes: prefill,
    askCost: !!task.cost && task.cost.high > 0,
    askEvidence: true,
    askSurprise: true,
  };
}

export type SessionEndPrompt =
  { kind: 'handoff'; prompt: string; skippable: true } | { kind: 'memory'; prompt: string };

export function sessionEndHook(session: Session): SessionEndPrompt {
  if (session.mode === 'execute') {
    return {
      kind: 'handoff',
      prompt: 'Where did you stop, and what’s the very next step?',
      skippable: true,
    };
  }
  return { kind: 'memory', prompt: 'Anything decided or learned that future-you needs?' };
}

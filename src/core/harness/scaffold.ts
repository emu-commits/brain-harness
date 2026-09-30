import type { Goal, Session } from '../model/types';

// Scaffold levels fade support as skill is demonstrated (SPEC §7.5). Never demote automatically.

export const PROMOTION_SESSIONS = 3;
export const PROMOTION_RESOLVE_RATE = 0.8;

export function qualifies(s: Session): boolean {
  const st = s.gapStats;
  if (s.mode !== 'plan' || !s.endedAt || !st || st.shown === 0) return false;
  return st.resolved / st.shown >= PROMOTION_RESOLVE_RATE && st.stuckTaps === 0;
}

/**
 * 1→2 after 3 Plan sessions (since the last level change) where the user resolved ≥ 80% of
 * shown gaps without "I'm stuck"; 2→3 the same way. One step at a time; never demotes.
 */
export function promotedLevel(goal: Goal, sessions: readonly Session[]): Goal['scaffoldLevel'] {
  if (goal.scaffoldLevel >= 3) return goal.scaffoldLevel;
  const since = goal.scaffoldChangedAt ?? '';
  const count = sessions.filter(
    (s) => s.goalId === goal.id && s.startedAt > since && qualifies(s),
  ).length;
  return count >= PROMOTION_SESSIONS ? ((goal.scaffoldLevel + 1) as 2 | 3) : goal.scaffoldLevel;
}

import type { ID, ISOTime, Settings, Workspace } from '../model/types';
import { cmp, loggedMinutesByTask } from '../model/factories';
import { daysBetweenTimes } from '../util/dates';

// Stuck detector (SPEC §5.3).

export type StuckReason =
  | { kind: 'sessions'; count: number }
  | { kind: 'overrun'; loggedMinutes: number; limitMinutes: number }
  | { kind: 'blocked'; days: number };

/**
 * A task is stuck if any of:
 *  - in progress across ≥ N Execute sessions since its last evidence, without completion;
 *  - logged minutes > estimate.high × overrunFactor;
 *  - user-blocked for more than blockedDays.
 */
export function detectStuck(
  ws: Workspace,
  goalId: ID,
  now: ISOTime,
  th: Settings['stuck'],
): Record<ID, StuckReason[]> {
  const logged = loggedMinutesByTask(ws);
  const execSessions = new Set(ws.sessions.filter((s) => s.mode === 'execute').map((s) => s.id));
  const out: Record<ID, StuckReason[]> = {};
  const tasks = ws.tasks.filter((t) => t.goalId === goalId).sort((a, b) => cmp(a.id, b.id));
  for (const t of tasks) {
    if (t.status === 'completed' || t.status === 'skipped') continue;
    const reasons: StuckReason[] = [];
    if (t.status === 'inProgress') {
      const lastEvidence = ws.evidence
        .filter((e) => e.taskId === t.id)
        .reduce<string>((m, e) => (e.createdAt > m ? e.createdAt : m), '');
      const sessions = new Set(
        ws.executionRecords
          .filter(
            (r) => r.taskId === t.id && execSessions.has(r.sessionId) && r.endedAt > lastEvidence,
          )
          .map((r) => r.sessionId),
      );
      if (sessions.size >= th.sessions) reasons.push({ kind: 'sessions', count: sessions.size });
    }
    const high = t.estimateMinutes?.high;
    const mins = logged[t.id] ?? 0;
    if (t.kind !== 'wait' && high !== undefined && high > 0 && mins > high * th.overrunFactor) {
      reasons.push({ kind: 'overrun', loggedMinutes: mins, limitMinutes: high * th.overrunFactor });
    }
    if (t.status === 'blocked' && t.blockedAt) {
      const days = daysBetweenTimes(t.blockedAt, now);
      if (days > th.blockedDays) reasons.push({ kind: 'blocked', days });
    }
    if (reasons.length) out[t.id] = reasons;
  }
  return out;
}

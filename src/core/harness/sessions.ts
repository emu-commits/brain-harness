import type { Clock } from '../util/clock';
import type { IdGen } from '../util/ids';
import type { ID, Session, SessionMode, TableName, Task, Workspace } from '../model/types';
import { TABLE_KEYS, TABLES } from '../model/types';
import { cmp } from '../model/factories';
import { stableStringify } from '../util/hash';

// Session modes (SPEC §5.1). Each session has exactly one mode, and mode decides what can change.

export function openSessions(ws: Workspace): Session[] {
  return ws.sessions.filter((s) => !s.endedAt);
}

/** The open session, if any (latest started wins). */
export function activeSession(ws: Workspace): Session | undefined {
  return openSessions(ws).sort((a, b) => cmp(b.startedAt, a.startedAt))[0];
}

export function sessionsOfGoal(ws: Workspace, goalId: ID): Session[] {
  return ws.sessions
    .filter((s) => s.goalId === goalId)
    .sort((a, b) => cmp(a.startedAt, b.startedAt) || cmp(a.id, b.id));
}

export function lastEndedSession(ws: Workspace, goalId: ID): Session | undefined {
  return sessionsOfGoal(ws, goalId)
    .filter((s) => s.endedAt)
    .sort((a, b) => cmp(b.endedAt!, a.endedAt!))[0];
}

/** Start a session. Any open session is ended first: switching modes is deliberate friction. */
export function startSession(
  ws: Workspace,
  goalId: ID,
  mode: SessionMode,
  ids: IdGen,
  clock: Clock,
): { ws: Workspace; session: Session } {
  const now = clock.now();
  const session: Session = { id: ids.next(), goalId, mode, startedAt: now };
  if (mode === 'plan') session.gapStats = { shown: 0, resolved: 0, stuckTaps: 0 };
  const sessions = ws.sessions.map((s) => (s.endedAt ? s : { ...s, endedAt: now }));
  return { ws: { ...ws, sessions: [...sessions, session] }, session };
}

export function endSession(
  ws: Workspace,
  sessionId: ID,
  clock: Clock,
  patch: Pick<Session, 'handoffNote' | 'handoffSkipped'> = {},
): Workspace {
  return {
    ...ws,
    sessions: ws.sessions.map((s) =>
      s.id === sessionId ? { ...s, ...patch, endedAt: s.endedAt ?? clock.now() } : s,
    ),
  };
}

// ---- Mode permissions ----

/** Tables anyone can write in any mode (records of reality, preferences, UI state). */
const ALWAYS: ReadonlySet<TableName> = new Set<TableName>([
  'sessions',
  'executionRecords',
  'evidence',
  'memory',
  'predictions',
  'snapshots',
  'settings',
  'gapDismissals',
  'questionStats',
  'capacities',
]);

/** Task fields Execute mode may change: status, actuals-related state, notes. */
export const EXECUTE_TASK_FIELDS: ReadonlySet<keyof Task> = new Set<keyof Task>([
  'status',
  'completedAt',
  'skippedReason',
  'definitionOfDone',
  'intention',
  'blockedAt',
  'blockerNote',
  'delegatedTo',
]);

export interface ModeViolation {
  table: TableName;
  id: string;
  message: string;
}

const MODE_LABEL: Record<SessionMode, string> = {
  plan: 'Plan',
  execute: 'Execute',
  review: 'Review',
};

function changedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => stableStringify(a[k]) !== stableStringify(b[k]));
}

/**
 * Compare two workspaces and report changes the current mode does not allow.
 * Plan: everything. Execute: task status/actuals/evidence/notes and inbox capture.
 * Review: assumptions and calibration decisions. No session: records and settings only.
 */
export function checkModePermissions(
  prev: Workspace,
  next: Workspace,
  mode: SessionMode | null,
): ModeViolation[] {
  if (mode === 'plan') return [];
  const where = mode ? `in a ${MODE_LABEL[mode]} session` : 'outside a session';
  const out: ModeViolation[] = [];
  for (const table of TABLES) {
    if (ALWAYS.has(table)) continue;
    if (mode === 'review' && (table === 'assumptions' || table === 'calibrationDecisions'))
      continue;
    const key = TABLE_KEYS[table];
    const a = new Map(
      (prev[table] as unknown as Record<string, unknown>[]).map((r) => [r[key] as string, r]),
    );
    const b = new Map(
      (next[table] as unknown as Record<string, unknown>[]).map((r) => [r[key] as string, r]),
    );
    for (const [id, row] of b) {
      const old = a.get(id);
      if (old === row) continue;
      if (table === 'tasks' && mode === 'execute') {
        if (!old) {
          if ((row as unknown as Task).milestoneId !== undefined) {
            out.push({
              table,
              id,
              message: 'Execute mode can only capture new tasks to the inbox',
            });
          }
          continue;
        }
        const bad = changedFields(old, row).filter(
          (f) => !EXECUTE_TASK_FIELDS.has(f as keyof Task),
        );
        if (bad.length)
          out.push({ table, id, message: `Changing ${bad.join(', ')} needs a Plan session` });
        continue;
      }
      if (!old || changedFields(old, row).length) {
        out.push({
          table,
          id,
          message: `Changing ${table} ${where} isn't allowed. Start a Plan session.`,
        });
      }
    }
    for (const id of a.keys()) {
      if (!b.has(id))
        out.push({
          table,
          id,
          message: `Removing from ${table} ${where} isn't allowed. Start a Plan session.`,
        });
    }
  }
  return out;
}

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MemoryEntry, SessionMode, Workspace } from '../core/model/types';
import { endSession, startSession } from '../core/harness/sessions';
import { sessionEndHook } from '../core/harness/hooks';
import { promotedLevel } from '../core/harness/scaffold';
import { upsert } from '../core/model/factories';
import { useStore } from './store';
import { Errors, Sheet } from './components/Sheet';
import { useToast } from './toast';

// Session switching with deliberate friction: ending a session runs its sessionEnd hook.

interface SessionApi {
  /** Ensure a session of `mode` is active, ending (with its hook) any other. Resolves false if cancelled. */
  ensure(mode: SessionMode): Promise<boolean>;
  /** End the current session (with its hook). */
  end(): Promise<boolean>;
}

const Ctx = createContext<SessionApi | null>(null);

export const MODE_LABEL: Record<SessionMode, string> = {
  plan: 'Plan',
  execute: 'Execute',
  review: 'Review',
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const { ws, goal, session, commit, ids, clock } = useStore();
  const toast = useToast();
  const [pending, setPending] = useState<{
    to: SessionMode | null;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const start = useCallback(
    async (mode: SessionMode) => {
      if (!goal) return false;
      const r = await commit((w) => startSession(w, goal.id, mode, ids, clock).ws);
      return r.ok;
    },
    [goal, commit, ids, clock],
  );

  const ensure = useCallback(
    (mode: SessionMode) => {
      if (session?.mode === mode && session.goalId === goal?.id) return Promise.resolve(true);
      if (!session) return start(mode);
      return new Promise<boolean>((resolve) => setPending({ to: mode, resolve }));
    },
    [session, goal, start],
  );

  const end = useCallback(() => {
    if (!session) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPending({ to: null, resolve }));
  }, [session]);

  const finish = async (note: string, kind: MemoryEntry['kind'], skipped: boolean) => {
    if (!session || !pending) return;
    const r = await commit((w: Workspace) => {
      let next = w;
      if (session.mode === 'execute') {
        next = endSession(
          next,
          session.id,
          clock,
          skipped ? { handoffSkipped: true } : { handoffNote: note.trim() },
        );
      } else {
        if (note.trim()) {
          const m: MemoryEntry = {
            id: ids.next(),
            goalId: session.goalId,
            kind,
            text: note.trim(),
            createdAt: clock.now(),
            sessionId: session.id,
          };
          next = { ...next, memory: [...next.memory, m] };
        }
        next = endSession(next, session.id, clock);
        if (session.mode === 'plan') {
          const g = next.goals.find((x) => x.id === session.goalId);
          if (g) {
            const level = promotedLevel(g, next.sessions);
            if (level !== g.scaffoldLevel) {
              next = {
                ...next,
                goals: upsert(next.goals, {
                  ...g,
                  scaffoldLevel: level,
                  scaffoldChangedAt: clock.now(),
                }),
              };
              toast(
                `Questions will be shorter from now on (level ${level}). You can change this in Settings.`,
              );
            }
          }
        }
      }
      return next;
    });
    if (!r.ok) return;
    const p = pending;
    setPending(null);
    if (p.to) p.resolve(await start(p.to));
    else p.resolve(true);
  };

  const api = useMemo(() => ({ ensure, end }), [ensure, end]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {pending && session && (
        <EndSessionSheet
          mode={session.mode}
          to={pending.to}
          onCancel={() => {
            pending.resolve(false);
            setPending(null);
          }}
          onDone={finish}
          handoffCount={ws.sessions.filter((s) => s.handoffNote).length}
        />
      )}
    </Ctx.Provider>
  );
}

function EndSessionSheet(props: {
  mode: SessionMode;
  to: SessionMode | null;
  handoffCount: number;
  onCancel: () => void;
  onDone: (note: string, kind: MemoryEntry['kind'], skipped: boolean) => Promise<void>;
}) {
  const hook = sessionEndHook({ id: '', goalId: '', mode: props.mode, startedAt: '' });
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<MemoryEntry['kind']>(
    props.mode === 'review' ? 'lesson' : 'decision',
  );
  const [errors, setErrors] = useState<string[]>([]);
  const title = props.to
    ? `End ${MODE_LABEL[props.mode]} session and start ${MODE_LABEL[props.to]}?`
    : `End ${MODE_LABEL[props.mode]} session`;
  return (
    <Sheet
      title={title}
      onClose={props.onCancel}
      footer={
        <>
          {hook.kind === 'handoff' ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => props.onDone('', kind, true)}
            >
              Skip
            </button>
          ) : (
            <button
              type="button"
              className="btn ghost"
              onClick={() => props.onDone('', kind, false)}
            >
              Nothing to add
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (hook.kind === 'handoff' && !note.trim())
                return setErrors(['Write a line, or tap Skip.']);
              void props.onDone(note, kind, false);
            }}
          >
            Save and end
          </button>
        </>
      }
    >
      <label className="prompt" htmlFor="end-note">
        {hook.prompt}
      </label>
      {hook.kind === 'handoff' && <p className="hint">Future-you sees this first next time.</p>}
      {hook.kind === 'memory' && (
        <div className="seg" role="radiogroup" aria-label="Kind">
          {(['decision', 'lesson'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'on' : ''}
              onClick={() => setKind(k)}
            >
              {k === 'decision' ? 'Decision' : 'Lesson'}
            </button>
          ))}
        </div>
      )}
      <textarea
        id="end-note"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={hook.kind === 'handoff' ? 'Stopped at… Next: …' : ''}
      />
      <Errors errors={errors} />
    </Sheet>
  );
}

export function useSessionApi(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessionApi outside SessionProvider');
  return v;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { Goal, ImageBlob, Session, Settings, Workspace } from '../core/model/types';
import { DEFAULT_SETTINGS, emptyWorkspace, getSettings, goalById } from '../core/model/factories';
import { validateWorkspace } from '../core/validation/validate';
import type { ValidationError } from '../core/validation/validate';
import { activeSession, checkModePermissions } from '../core/harness/sessions';
import type { Clock } from '../core/util/clock';
import type { IdGen } from '../core/util/ids';
import type { Storage } from '../data/storage';

// App state: the whole workspace in memory. Every write goes through commit(), which validates,
// checks session-mode permissions, persists atomically, and only then updates the UI.

export type CommitResult = { ok: true; ws: Workspace } | { ok: false; errors: string[] };
export type Mutator = (
  ws: Workspace,
) => Workspace | { ok: false; error: ValidationError[] } | { ok: true; value: { ws: Workspace } };

interface StoreValue {
  ws: Workspace;
  ready: boolean;
  clock: Clock;
  ids: IdGen;
  storage: Storage;
  settings: Settings;
  goal: Goal | undefined;
  session: Session | undefined;
  commit(fn: Mutator, opts?: { bypassModeGuard?: boolean }): Promise<CommitResult>;
  replace(ws: Workspace, images: ImageBlob[]): Promise<void>;
}

const Ctx = createContext<StoreValue | null>(null);

function unwrap(r: ReturnType<Mutator>): { ws?: Workspace; errors?: ValidationError[] } {
  if ('ok' in r) {
    if (!r.ok) return { errors: r.error };
    return { ws: r.value.ws };
  }
  return { ws: r };
}

export function StoreProvider(props: {
  storage: Storage;
  clock: Clock;
  ids: IdGen;
  children: ReactNode;
}) {
  const { storage, clock, ids } = props;
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const ref = useRef(ws);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const askedPersist = useRef(false);

  useEffect(() => {
    let live = true;
    storage.load().then((loaded) => {
      if (!live) return;
      ref.current = loaded;
      setWs(loaded);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [storage]);

  const commit = useCallback(
    (fn: Mutator, opts: { bypassModeGuard?: boolean } = {}): Promise<CommitResult> => {
      const run = async (): Promise<CommitResult> => {
        const prev = ref.current;
        let next: Workspace;
        try {
          const r = unwrap(fn(prev));
          if (r.errors) return { ok: false, errors: r.errors.map((e) => e.message) };
          next = r.ws!;
        } catch (e) {
          return { ok: false, errors: [(e as Error).message] };
        }
        if (next === prev) return { ok: true, ws: prev };
        const errors = validateWorkspace(next);
        if (errors.length) return { ok: false, errors: errors.map((e) => e.message) };
        if (!opts.bypassModeGuard) {
          const mode = activeSession(next)?.mode ?? activeSession(prev)?.mode ?? null;
          const violations = checkModePermissions(prev, next, mode);
          if (violations.length)
            return { ok: false, errors: [...new Set(violations.map((v) => v.message))] };
        }
        await storage.commit(prev, next);
        ref.current = next;
        setWs(next);
        if (!askedPersist.current && next.goals.length) {
          askedPersist.current = true;
          void requestPersistence(storage, ref, setWs);
        }
        return { ok: true, ws: next };
      };
      const p = queue.current.then(run, run);
      queue.current = p;
      return p;
    },
    [storage],
  );

  const replace = useCallback(
    async (next: Workspace, images: ImageBlob[]) => {
      await storage.replaceAll(next, images);
      ref.current = next;
      setWs(next);
    },
    [storage],
  );

  const settings = getSettings(ws);
  const goal =
    goalById(ws, settings.activeGoalId) ?? ws.goals.find((g) => !g.isDemo) ?? ws.goals[0];
  const value = useMemo<StoreValue>(
    () => ({
      ws,
      ready,
      clock,
      ids,
      storage,
      settings,
      goal,
      session: activeSession(ws),
      commit,
      replace,
    }),
    [ws, ready, clock, ids, storage, settings, goal, commit, replace],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

async function requestPersistence(
  storage: Storage,
  ref: { current: Workspace },
  setWs: (w: Workspace) => void,
) {
  try {
    if (!navigator.storage?.persist) return;
    const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    const prev = ref.current;
    const s = getSettings(prev);
    if (s.storagePersisted === persisted) return;
    const next = { ...prev, settings: [{ ...s, storagePersisted: persisted }] };
    await storage.commit(prev, next);
    ref.current = next;
    setWs(next);
  } catch {
    // Not supported; Settings shows the status as unknown.
  }
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

/** Update the settings row. */
export function withSettings(ws: Workspace, patch: Partial<Settings>): Workspace {
  const s = ws.settings[0] ?? DEFAULT_SETTINGS;
  return { ...ws, settings: [{ ...s, ...patch }] };
}

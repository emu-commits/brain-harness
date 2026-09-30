import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, withSettings } from '../../store';
import { useSessionApi } from '../../session';
import type { Capacity, Settings as SettingsRow, Workspace } from '../../../core/model/types';
import { capacityOf, emptyWorkspace, getSettings, upsert } from '../../../core/model/factories';
import { daysBetweenTimes } from '../../../core/util/dates';
import { exportWorkspace, parseImport } from '../../../data/exportImport';
import { buildDemo, removeGoal } from '../../../data/demo';
import { CapacityInput, Field, WEEKDAYS } from '../../components/inputs';
import { Errors, Sheet } from '../../components/Sheet';
import { DISCLAIMER } from '../Plan/MoneyView';
import { fmtDate } from '../../format';

export function Settings() {
  const { ws, goal } = useStore();
  return (
    <div className="page settings">
      <h1 className="page-title">Settings</h1>
      <Goals />
      {goal && <CapacitySection key={goal.id} />}
      {goal && <Scaffold />}
      <Thresholds />
      <Data />
      <Demo />
      <Install />
      <section className="card about">
        <h2>About</h2>
        <p>
          GoalGraph is a harness for your brain: it asks, schedules, measures and remembers, and it
          never plans for you. Every task, estimate and number in your plan is yours.
        </p>
        <p className="muted small">{DISCLAIMER}</p>
        <p className="muted small">
          Private by construction: no account, no server, no analytics. After the first load,
          nothing leaves this browser. MIT licensed.
        </p>
        <p className="muted small">
          {ws.goals.length
            ? `${ws.goals.length} goal${ws.goals.length === 1 ? '' : 's'} · ${ws.tasks.length} tasks stored locally`
            : 'Nothing stored yet.'}
        </p>
      </section>
    </div>
  );
}

function Goals() {
  const { ws, goal, commit, session } = useStore();
  const api = useSessionApi();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <section className="card">
      <h2>Goals</h2>
      <ul className="rows">
        {ws.goals.map((g) => (
          <li key={g.id} className="goal-row">
            <span>
              {g.title} {g.isDemo && <span className="badge demo">demo</span>}{' '}
              {g.id === goal?.id && <span className="badge">active</span>}
            </span>
            <span className="row-actions">
              {g.id !== goal?.id && (
                <button
                  type="button"
                  className="btn small"
                  onClick={async () => {
                    if (session && !(await api.end())) return;
                    await commit((w) => withSettings(w, { activeGoalId: g.id }));
                    navigate('/today');
                  }}
                >
                  Switch
                </button>
              )}
              {confirm === g.id ? (
                <button
                  type="button"
                  className="btn danger small"
                  onClick={async () => {
                    await commit(
                      (w) =>
                        withSettings(removeGoal(w, g.id), {
                          activeGoalId: w.goals.find((x) => x.id !== g.id)?.id,
                          running: undefined,
                        }),
                      { bypassModeGuard: true },
                    );
                    setConfirm(null);
                  }}
                >
                  Delete for good
                </button>
              ) : (
                <button type="button" className="btn ghost small" onClick={() => setConfirm(g.id)}>
                  Delete
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Link className="btn" to="/welcome">
        Start a new goal
      </Link>
    </section>
  );
}

function CapacitySection() {
  const { ws, goal, commit } = useStore();
  const cap = capacityOf(ws, goal!.id);
  const [draft, setDraft] = useState<Capacity>(cap);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const peaks = draft.peakWindows ?? [];
  return (
    <section className="card">
      <h2>Weekly capacity</h2>
      <p className="muted small">
        How many hours a week you can realistically give “{goal!.title}”. The forecast is only as
        honest as this.
      </p>
      <CapacityInput
        value={draft.minutesByWeekday}
        onChange={(w) => (setDraft({ ...draft, minutesByWeekday: w }), setSaved(false))}
      />
      <h3 className="eyebrow">Peak hours (for deep work)</h3>
      <p className="muted small">
        When a peak window is on, Today suggests deep tasks; outside it, shallow ones.
      </p>
      <ul className="rows">
        {peaks.map((p, i) => (
          <li key={i} className="peak-row">
            <select
              aria-label="Day"
              value={p.weekday}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  peakWindows: peaks.map((x, j) =>
                    j === i ? { ...x, weekday: Number(e.target.value) } : x,
                  ),
                })
              }
            >
              {WEEKDAYS.map((d, j) => (
                <option key={d} value={j}>
                  {d}
                </option>
              ))}
            </select>
            <input
              aria-label="From"
              type="time"
              value={p.start}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  peakWindows: peaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                })
              }
            />
            <input
              aria-label="To"
              type="time"
              value={p.end}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  peakWindows: peaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                })
              }
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="Remove window"
              onClick={() => setDraft({ ...draft, peakWindows: peaks.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <button
          type="button"
          className="link-btn"
          onClick={() =>
            setDraft({
              ...draft,
              peakWindows: [...peaks, { weekday: 6, start: '08:00', end: '11:00' }],
            })
          }
        >
          + Peak window
        </button>
        <span className="spacer" />
        {saved && <span className="muted small">Saved.</span>}
        <button
          type="button"
          className="btn primary small"
          onClick={async () => {
            if (peaks.some((p) => p.start >= p.end))
              return setErrors(['Each window has to end after it starts.']);
            const next = { ...draft };
            if (!peaks.length) delete next.peakWindows;
            const r = await commit((w) => ({
              ...w,
              capacities: upsert(w.capacities, next, 'goalId'),
            }));
            setErrors(r.ok ? [] : r.errors);
            setSaved(r.ok);
          }}
        >
          Save capacity
        </button>
      </div>
      <Errors errors={errors} />
    </section>
  );
}

function Scaffold() {
  const { goal, commit, clock } = useStore();
  const g = goal!;
  const setGoal = (patch: Partial<typeof g>) =>
    commit((w) => ({ ...w, goals: upsert(w.goals, { ...g, ...patch }) }), {
      bypassModeGuard: true,
    });
  return (
    <section className="card">
      <h2>Questions and currency</h2>
      <Field
        label="How much guidance the questions give"
        hint="It fades by itself as you plan without getting stuck. It never increases on its own."
      >
        {(id) => (
          <select
            id={id}
            value={g.scaffoldLevel}
            onChange={(e) =>
              void setGoal({
                scaffoldLevel: Number(e.target.value) as 1 | 2 | 3,
                scaffoldChangedAt: clock.now(),
              })
            }
          >
            <option value={1}>Guided: full prompts, helper text, examples</option>
            <option value={2}>Prompted: shorter prompts, examples on request</option>
            <option value={3}>Open: only the most important questions</option>
          </select>
        )}
      </Field>
      <Field label="Currency (ISO code)">
        {(id) => (
          <input
            id={id}
            className="short"
            defaultValue={g.currency}
            maxLength={3}
            onBlur={(e) => {
              const c = e.target.value.trim().toUpperCase();
              if (/^[A-Z]{3}$/.test(c) && c !== g.currency) void setGoal({ currency: c });
            }}
          />
        )}
      </Field>
    </section>
  );
}

function Thresholds() {
  const { ws, commit } = useStore();
  const s = getSettings(ws);
  const [errors, setErrors] = useState<string[]>([]);
  const num = (
    label: string,
    value: number,
    apply: (n: number) => Partial<SettingsRow>,
    hint?: string,
    min = 0,
  ) => (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          className="short"
          inputMode="decimal"
          defaultValue={value}
          onBlur={async (e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n) || n < min)
              return setErrors([`${label}: enter a number ≥ ${min}.`]);
            const r = await commit((w) => withSettings(w, apply(n)));
            setErrors(r.ok ? [] : r.errors);
          }}
        />
      )}
    </Field>
  );
  return (
    <section className="card">
      <h2>Thresholds</h2>
      <div className="grid2">
        {num(
          'Show the handoff first after (days away)',
          s.resumeThresholdDays,
          (n) => ({ resumeThresholdDays: Math.round(n) }),
          undefined,
          1,
        )}
        {num(
          'Questions per Plan session',
          s.maxGapsPerSession,
          (n) => ({ maxGapsPerSession: Math.round(n) }),
          undefined,
          1,
        )}
        {num(
          'Suggest splitting tasks longer than (minutes)',
          s.splitThresholdMinutes,
          (n) => ({ splitThresholdMinutes: Math.round(n) }),
          undefined,
          15,
        )}
        {num('Assume blocked tasks unblock after (days)', s.blockedAssumeDays, (n) => ({
          blockedAssumeDays: Math.round(n),
        }))}
        {num(
          'Stuck after this many sessions without evidence',
          s.stuck.sessions,
          (n) => ({ stuck: { ...s.stuck, sessions: Math.round(n) } }),
          undefined,
          1,
        )}
        {num(
          'Stuck when time logged exceeds worst case ×',
          s.stuck.overrunFactor,
          (n) => ({ stuck: { ...s.stuck, overrunFactor: n } }),
          undefined,
          1,
        )}
        {num(
          'Stuck when blocked longer than (days)',
          s.stuck.blockedDays,
          (n) => ({ stuck: { ...s.stuck, blockedDays: Math.round(n) } }),
          undefined,
          1,
        )}
      </div>
      <Errors errors={errors} />
    </section>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Data() {
  const { ws, commit, clock, storage, replace } = useStore();
  const navigate = useNavigate();
  const s = getSettings(ws);
  const [persisted, setPersisted] = useState<boolean | null>(s.storagePersisted ?? null);
  const [pending, setPending] = useState<{
    ws: Workspace;
    images: Awaited<ReturnType<typeof storage.allImages>>;
  } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [wipe, setWipe] = useState(false);
  const [wipeText, setWipeText] = useState('');
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);
  const daysSinceExport = s.lastExportAt ? daysBetweenTimes(s.lastExportAt, clock.now()) : null;
  const remind = ws.goals.length > 0 && (daysSinceExport === null || daysSinceExport >= 14);
  return (
    <section className="card">
      <h2>Your data</h2>
      <p className="muted small">
        Stored only in this browser (IndexedDB).{' '}
        {persisted === true
          ? 'The browser has agreed to keep it (persistent storage is on).'
          : persisted === false
            ? 'The browser may clear it if space runs low or the site isn’t visited for a while. Export regularly; on iPhone, adding to the Home Screen helps.'
            : 'Persistent storage status is unknown in this browser.'}
      </p>
      {persisted === false && (
        <button
          type="button"
          className="link-btn"
          onClick={() => navigator.storage?.persist?.().then(setPersisted)}
        >
          Ask the browser to keep it
        </button>
      )}
      {remind && (
        <p className="notice">
          {daysSinceExport === null
            ? 'You haven’t exported a backup yet.'
            : `Last exported ${daysSinceExport} days ago (${fmtDate(s.lastExportAt!.slice(0, 10))}).`}
        </p>
      )}
      <div className="row-actions wrap">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const text = await exportWorkspace(ws, await storage.allImages(), clock.now());
            download(`goalgraph-${clock.today()}.json`, text);
            await commit((w) => withSettings(w, { lastExportAt: clock.now() }));
          }}
        >
          Export (JSON)
        </button>
        <label className="btn">
          Import…
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const r = parseImport(await f.text());
              if (!r.ok) return setErrors(r.error);
              setErrors([]);
              setPending(r.value);
            }}
          />
        </label>
        <button type="button" className="btn danger ghost" onClick={() => setWipe(true)}>
          Delete all data
        </button>
      </div>
      <Errors errors={errors} />
      {pending && (
        <Sheet
          title="Replace everything with this file?"
          onClose={() => setPending(null)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  await replace(pending.ws, pending.images);
                  setPending(null);
                  navigate('/today');
                }}
              >
                Replace
              </button>
            </>
          }
        >
          <p>
            The file is valid: {pending.ws.goals.length} goal(s), {pending.ws.tasks.length} tasks.
            Importing replaces everything currently in this browser.
          </p>
        </Sheet>
      )}
      {wipe && (
        <Sheet
          title="Delete all data?"
          onClose={() => setWipe(false)}
          footer={
            <button
              type="button"
              className="btn danger"
              disabled={wipeText !== 'DELETE'}
              onClick={async () => {
                await replace(emptyWorkspace(), []);
                setWipe(false);
                navigate('/welcome');
              }}
            >
              Delete everything
            </button>
          }
        >
          <p>
            This removes every goal, task, note and record from this browser. It can’t be undone.
            Export first if you might want it back.
          </p>
          <Field label="Type DELETE to confirm">
            {(id) => (
              <input
                id={id}
                value={wipeText}
                onChange={(e) => setWipeText(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
        </Sheet>
      )}
    </section>
  );
}

function Demo() {
  const { ws, commit, ids, clock, session } = useStore();
  const api = useSessionApi();
  const navigate = useNavigate();
  const demo = ws.goals.find((g) => g.isDemo);
  return (
    <section className="card">
      <h2>Demo</h2>
      <p className="muted small">
        A fictional sample goal (a weekend bread stall) with a plan, a few sessions and some
        history, so you can see the loop working. Kept separate from your goals.
      </p>
      {demo ? (
        <button
          type="button"
          className="btn"
          onClick={() =>
            void commit(
              (w) =>
                withSettings(removeGoal(w, demo.id), {
                  activeGoalId: w.goals.find((g) => !g.isDemo)?.id,
                }),
              { bypassModeGuard: true },
            )
          }
        >
          Remove the demo
        </button>
      ) : (
        <button
          type="button"
          className="btn"
          onClick={async () => {
            if (session && !(await api.end())) return;
            const r = await commit(
              (w) => {
                const d = buildDemo(w, ids, clock);
                return withSettings(d.ws, { activeGoalId: d.goalId });
              },
              { bypassModeGuard: true },
            );
            if (r.ok) navigate('/today');
          }}
        >
          Load the demo
        </button>
      )}
    </section>
  );
}

function Install() {
  return (
    <section className="card">
      <h2>Add to your Home Screen</h2>
      <ul className="plain small">
        <li>
          <strong>iPhone / iPad (Safari):</strong> tap Share, then “Add to Home Screen”. This also
          makes Safari far less likely to clear your data.
        </li>
        <li>
          <strong>Android (Chrome):</strong> menu ⋮, then “Add to Home screen” or “Install app”.
        </li>
        <li>
          <strong>Desktop:</strong> use your browser’s install icon in the address bar, or bookmark
          it.
        </li>
      </ul>
    </section>
  );
}

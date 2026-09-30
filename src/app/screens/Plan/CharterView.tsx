import { useState } from 'react';
import { useStore } from '../../store';
import type {
  Commitment,
  Goal,
  PremortemEntry,
  SuccessCriterion,
  TrackedBy,
  Workspace,
} from '../../../core/model/types';
import {
  capacityOf,
  milestonesOfGoal,
  newTask,
  totalWeeklyMinutes,
  upsert,
} from '../../../core/model/factories';
import { applyAnswer } from '../../../core/questions/apply';
import { promptFor, question } from '../../../core/questions/bank';
import { Errors, Sheet } from '../../components/Sheet';
import { Field, MoneyInput, TaskListInput } from '../../components/inputs';
import { fmtDate, fmtMinutes, fmtMoney } from '../../format';

const TRACKED: { kind: TrackedBy['kind']; label: string }[] = [
  { kind: 'tasks', label: 'When all milestones are done' },
  { kind: 'manual', label: 'I’ll record the value myself' },
  { kind: 'netWorth', label: 'Modeled net worth reaches the target' },
  { kind: 'monthlyRevenue', label: 'Modeled monthly revenue reaches the target' },
  { kind: 'accountBalance', label: 'An account balance reaches the target' },
];
const MONEY = new Set(['netWorth', 'monthlyRevenue', 'accountBalance']);

export function CharterView({ editable }: { editable: boolean }) {
  const { ws, goal, commit, clock } = useStore();
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [g, setG] = useState<Goal | undefined>(goal);
  const [premortem, setPremortem] = useState(false);
  if (!goal || !g) return null;
  const crit: SuccessCriterion = g.successCriteria[0] ?? {
    id: '',
    description: '',
    metric: '',
    unit: '',
    target: 1,
    deadline: g.targetDate,
    trackedBy: { kind: 'tasks' },
  };
  const setCrit = (patch: Partial<SuccessCriterion>) =>
    setG({ ...g, successCriteria: [{ ...crit, ...patch }, ...g.successCriteria.slice(1)] });
  const setCharter = (patch: Partial<Goal['charter']>) =>
    setG({ ...g, charter: { ...g.charter, ...patch } });
  const accounts = ws.accounts.filter((a) => a.goalId === goal.id);
  const isMoney = MONEY.has(crit.trackedBy.kind);

  const save = async () => {
    const next = {
      ...g,
      successCriteria: g.successCriteria.map((c, i) =>
        i === 0
          ? { ...c, deadline: c.deadline === goal.targetDate ? g.targetDate : c.deadline }
          : c,
      ),
    };
    // Keep premortem & commitments from the live goal (edited separately below).
    const r = await commit((w) => ({
      ...w,
      goals: upsert(w.goals, {
        ...next,
        charter: {
          ...next.charter,
          premortem: goal.charter.premortem,
          commitments: goal.charter.commitments,
        },
      }),
    }));
    setErrors(r.ok ? [] : r.errors);
    setSaved(r.ok);
  };

  return (
    <div className="charter-view">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onChange={() => setSaved(false)}
      >
        <fieldset disabled={!editable} className="plain-fieldset">
          <Field label="Goal">
            {(id) => (
              <input
                id={id}
                value={g.title}
                onChange={(e) => setG({ ...g, title: e.target.value })}
              />
            )}
          </Field>
          <Field label="By when">
            {(id) => (
              <input
                id={id}
                type="date"
                value={g.targetDate}
                onChange={(e) => setG({ ...g, targetDate: e.target.value })}
              />
            )}
          </Field>
          {g.successCriteria[0] && (
            <>
              <Field label="What proves it’s done">
                {(id) => (
                  <textarea
                    id={id}
                    rows={2}
                    value={crit.description}
                    onChange={(e) => setCrit({ description: e.target.value })}
                  />
                )}
              </Field>
              <div className="row3">
                <Field label="What you count">
                  {(id) => (
                    <input
                      id={id}
                      value={crit.metric}
                      onChange={(e) => setCrit({ metric: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={isMoney ? `Target (${g.currency})` : 'Target'}>
                  {(id) =>
                    isMoney ? (
                      <MoneyInput
                        id={id}
                        value={crit.target}
                        onChange={(c) => c !== null && setCrit({ target: c })}
                      />
                    ) : (
                      <input
                        id={id}
                        inputMode="decimal"
                        value={String(crit.target)}
                        onChange={(e) => setCrit({ target: Number(e.target.value) })}
                      />
                    )
                  }
                </Field>
                <Field label="Unit">
                  {(id) => (
                    <input
                      id={id}
                      value={crit.unit}
                      onChange={(e) => setCrit({ unit: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <Field label="How is it tracked?">
                {(id) => (
                  <select
                    id={id}
                    value={crit.trackedBy.kind}
                    onChange={(e) => {
                      const kind = e.target.value as TrackedBy['kind'];
                      const tb: TrackedBy =
                        kind === 'accountBalance'
                          ? { kind, accountId: accounts[0]?.id ?? '' }
                          : ({ kind } as TrackedBy);
                      setCrit({ trackedBy: tb });
                    }}
                  >
                    {TRACKED.map((t) => (
                      <option
                        key={t.kind}
                        value={t.kind}
                        disabled={t.kind === 'accountBalance' && !accounts.length}
                      >
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {crit.trackedBy.kind === 'accountBalance' && (
                <Field label="Which account">
                  {(id) => (
                    <select
                      id={id}
                      value={
                        crit.trackedBy.kind === 'accountBalance' ? crit.trackedBy.accountId : ''
                      }
                      onChange={(e) =>
                        setCrit({
                          trackedBy: { kind: 'accountBalance', accountId: e.target.value },
                        })
                      }
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              {crit.trackedBy.kind === 'manual' && (
                <Field label="Latest value you recorded">
                  {(id) => (
                    <input
                      id={id}
                      inputMode="decimal"
                      value={crit.recorded?.value ?? ''}
                      onChange={(e) =>
                        setCrit({
                          recorded:
                            e.target.value.trim() === ''
                              ? undefined
                              : { value: Number(e.target.value), at: clock.now() },
                        })
                      }
                    />
                  )}
                </Field>
              )}
            </>
          )}
          <Field label="Why this matters to you">
            {(id) => (
              <textarea
                id={id}
                rows={2}
                value={g.charter.why}
                onChange={(e) => setCharter({ why: e.target.value })}
              />
            )}
          </Field>
          <Field label="The thing inside you most likely to get in the way">
            {(id) => (
              <input
                id={id}
                value={g.charter.obstacle}
                onChange={(e) => setCharter({ obstacle: e.target.value })}
              />
            )}
          </Field>
          <Field label="When that shows up, what will you do?">
            {(id) => (
              <input
                id={id}
                value={g.charter.obstaclePlan}
                onChange={(e) => setCharter({ obstaclePlan: e.target.value })}
              />
            )}
          </Field>
          <Errors errors={errors} />
          {editable && (
            <div className="row-actions">
              <button type="submit" className="btn primary">
                Save charter
              </button>
              {saved && <span className="muted small">Saved.</span>}
            </div>
          )}
        </fieldset>
      </form>

      <Premortem editable={editable} onRun={() => setPremortem(true)} />
      <Commitments editable={editable} />
      {premortem && <PremortemSheet onClose={() => setPremortem(false)} />}
    </div>
  );
}

function PremortemSheet({ onClose }: { onClose: () => void }) {
  const { goal, commit, ids, clock } = useStore();
  const [reasons, setReasons] = useState<string[]>(['']);
  const [errors, setErrors] = useState<string[]>([]);
  if (!goal) return null;
  const { prompt, helper } = promptFor(question('P1'), goal.scaffoldLevel, {
    deadline: fmtDate(goal.targetDate),
  });
  return (
    <Sheet
      title="Premortem"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            const r = await commit((w) => {
              const res = applyAnswer(
                w,
                question('P1'),
                { type: 'premortem', reasons },
                { goalId: goal.id, ids, clock },
              );
              return res.ok ? res.value.ws : res;
            });
            if (!r.ok) return setErrors(r.errors);
            onClose();
          }}
        >
          Save reasons
        </button>
      }
    >
      <p className="prompt">{prompt}</p>
      {helper && <p className="hint">{helper}</p>}
      <TaskListInput
        value={reasons}
        onChange={setReasons}
        label="Reason"
        placeholder="It failed because…"
      />
      <Errors errors={errors} />
    </Sheet>
  );
}

function Premortem({ editable, onRun }: { editable: boolean; onRun: () => void }) {
  const { ws, goal, commit, ids, clock } = useStore();
  const [open, setOpen] = useState<{ entry: PremortemEntry; kind: 'task' | 'assumption' } | null>(
    null,
  );
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  if (!goal) return null;
  const entries = goal.charter.premortem;
  const setEntry = (w: Workspace, e: PremortemEntry): Workspace => {
    const g = w.goals.find((x) => x.id === goal.id)!;
    return {
      ...w,
      goals: upsert(w.goals, {
        ...g,
        charter: {
          ...g.charter,
          premortem: g.charter.premortem.map((p) => (p.id === e.id ? e : p)),
        },
      }),
    };
  };
  const linkName = (e: PremortemEntry) =>
    e.response === 'task'
      ? ws.tasks.find((t) => t.id === e.linkedId)?.title
      : e.response === 'assumption'
        ? ws.assumptions.find((a) => a.id === e.linkedId)?.statement
        : undefined;
  return (
    <section className="card">
      <header className="ms-head">
        <h3>Premortem</h3>
        {editable && (
          <button type="button" className="btn small" onClick={onRun}>
            {entries.length ? 'Add reasons' : 'Run a premortem'}
          </button>
        )}
      </header>
      {!entries.length && (
        <p className="muted small">
          Imagine it’s {fmtDate(goal.targetDate)} and this didn’t happen. Why?
        </p>
      )}
      {entries.length > 0 && (
        <p className="hint">
          For each: what could you do now to make it less likely? Add a task, an assumption to test,
          or leave it as a known risk.
        </p>
      )}
      <ul className="premortem">
        {entries.map((e) => (
          <li key={e.id}>
            <p>{e.reason}</p>
            {e.response === 'risk' ? (
              editable ? (
                <div className="chips">
                  <span className="muted small">Known risk ·</span>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => (setOpen({ entry: e, kind: 'task' }), setText(''))}
                  >
                    Add a task
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => (setOpen({ entry: e, kind: 'assumption' }), setText(''))}
                  >
                    Add an assumption to test
                  </button>
                </div>
              ) : (
                <span className="muted small">Known risk</span>
              )
            ) : (
              <p className="muted small">
                → {e.response === 'task' ? 'Task' : 'Assumption'}: {linkName(e) ?? '(removed)'}
              </p>
            )}
            {open?.entry.id === e.id && (
              <form
                className="inline-form"
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  if (!text.trim()) return setErrors(['Write it in your words.']);
                  const r = await commit((w) => {
                    if (open.kind === 'task') {
                      const t = newTask(ids, clock, goal.id, text.trim());
                      return setEntry(
                        { ...w, tasks: [...w.tasks, t] },
                        { ...e, response: 'task', linkedId: t.id },
                      );
                    }
                    const a = {
                      id: ids.next(),
                      goalId: goal.id,
                      statement: text.trim(),
                      confidence: 'low' as const,
                      status: 'untested' as const,
                      history: [{ at: clock.now(), status: 'untested' as const }],
                    };
                    return setEntry(
                      { ...w, assumptions: [...w.assumptions, a] },
                      { ...e, response: 'assumption', linkedId: a.id },
                    );
                  });
                  if (!r.ok) return setErrors(r.errors);
                  setOpen(null);
                }}
              >
                <label htmlFor={`pm-${e.id}`}>
                  {open.kind === 'task'
                    ? 'What could you do now? (lands in the inbox)'
                    : 'What would have to be true — that you could test?'}
                </label>
                <input
                  id={`pm-${e.id}`}
                  value={text}
                  onChange={(x) => setText(x.target.value)}
                  autoFocus
                />
                <Errors errors={errors} />
                <div className="row-actions">
                  <button type="submit" className="btn primary small">
                    Add
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Commitments({ editable }: { editable: boolean }) {
  const { ws, goal, commit, ids } = useStore();
  const [text, setText] = useState('');
  const [rule, setRule] = useState<'none' | 'hours' | 'spend'>('none');
  const [hours, setHours] = useState('');
  const [spend, setSpend] = useState<number | null>(null);
  const [ms, setMs] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  if (!goal) return null;
  const milestones = milestonesOfGoal(ws, goal.id);
  const weekly = totalWeeklyMinutes(capacityOf(ws, goal.id));
  const save = (commitments: Commitment[]) =>
    commit((w) => {
      const g = w.goals.find((x) => x.id === goal.id)!;
      return { ...w, goals: upsert(w.goals, { ...g, charter: { ...g.charter, commitments } }) };
    });
  const describe = (c: Commitment) => {
    if (c.rule?.kind === 'maxWeeklyMinutes') {
      const over = weekly > c.rule.value;
      return (
        <span className={over ? 'warn' : 'muted'}>
          At most {fmtMinutes(c.rule.value)} a week
          {over ? ` · your capacity is ${fmtMinutes(weekly)}` : ''}
        </span>
      );
    }
    const r = c.rule;
    if (r?.kind === 'maxSpendBeforeMilestone') {
      const m = milestones.find((x) => x.id === r.milestoneId);
      return (
        <span className="muted">
          Spend at most {fmtMoney(r.cents, goal.currency)} before “{m?.title}”
        </span>
      );
    }
    return null;
  };
  return (
    <section className="card">
      <header className="ms-head">
        <h3>Commitments</h3>
        <span className="muted small">Guardrails. Only editable while planning.</span>
      </header>
      <ul className="commitments">
        {goal.charter.commitments.map((c) => (
          <li key={c.id}>
            <span>{c.text}</span> {describe(c)}
            {editable && (
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove commitment ${c.text}`}
                onClick={() => void save(goal.charter.commitments.filter((x) => x.id !== c.id))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return setErrors(['Write the commitment.']);
            const c: Commitment = { id: ids.next(), text: text.trim() };
            if (rule === 'hours') {
              const h = Number(hours);
              if (!Number.isFinite(h) || h < 0) return setErrors(['Hours should be a number.']);
              c.rule = { kind: 'maxWeeklyMinutes', value: Math.round(h * 60) };
            }
            if (rule === 'spend') {
              if (spend === null || !ms)
                return setErrors(['Enter an amount and pick a milestone.']);
              c.rule = { kind: 'maxSpendBeforeMilestone', cents: spend, milestoneId: ms };
            }
            const r = await save([...goal.charter.commitments, c]);
            if (!r.ok) return setErrors(r.errors);
            setText('');
            setRule('none');
            setErrors([]);
          }}
        >
          <input
            aria-label="New commitment"
            placeholder="+ A commitment (e.g. “No work on Sundays”)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row3">
            <select
              aria-label="Rule"
              value={rule}
              onChange={(e) => setRule(e.target.value as typeof rule)}
            >
              <option value="none">No numeric rule</option>
              <option value="hours">Max hours per week</option>
              <option value="spend">Max spend before a milestone</option>
            </select>
            {rule === 'hours' && (
              <input
                aria-label="Max hours per week"
                inputMode="decimal"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="hours"
              />
            )}
            {rule === 'spend' && (
              <>
                <MoneyInput onChange={setSpend} placeholder="amount" />
                <select aria-label="Milestone" value={ms} onChange={(e) => setMs(e.target.value)}>
                  <option value="">Milestone…</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <Errors errors={errors} />
          <div className="row-actions">
            <button type="submit" className="btn small">
              Add commitment
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

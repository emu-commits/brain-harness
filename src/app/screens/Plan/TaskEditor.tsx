import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import type { Dependency, ID, Task, Workspace } from '../../../core/model/types';
import { getSettings, milestonesOfGoal, tasksOfGoal, upsert } from '../../../core/model/factories';
import { cyclePathIfAdded } from '../../../core/engines/graph';
import { calibrationSamples, suggestMultiplier } from '../../../core/engines/calibration';
import { splitTask } from '../../../core/questions/apply';
import { Errors, Sheet } from '../../components/Sheet';
import {
  Field,
  MinutesRangeInput,
  MoneyRangeInput,
  NumberRangeInput,
  TaskListInput,
} from '../../components/inputs';
import { fmtDate, fmtMinutes } from '../../format';
import { useForecast } from '../../derived';

/** Edit every field of a task, its predecessors, or split it. Plan mode only. */
export function TaskEditor(props: {
  taskId: ID;
  editable: boolean;
  startWithSplit?: boolean;
  onClose: () => void;
}) {
  const { ws, goal, commit, ids, clock } = useStore();
  const { forecast } = useForecast();
  const orig = ws.tasks.find((t) => t.id === props.taskId);
  const [t, setT] = useState<Task | undefined>(orig);
  const [deps, setDeps] = useState<Dependency[]>(() =>
    ws.dependencies.filter((d) => d.toTaskId === props.taskId),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [splitting, setSplitting] = useState(!!props.startWithSplit);
  const [pieces, setPieces] = useState<string[]>(['', '']);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const goalTasks = useMemo(() => (goal ? tasksOfGoal(ws, goal.id) : []), [ws, goal]);
  const categories = useMemo(
    () => [...new Set(goalTasks.map((x) => x.category).filter(Boolean))] as string[],
    [goalTasks],
  );
  if (!orig || !t || !goal) return null;
  const milestones = milestonesOfGoal(ws, goal.id);
  const set = (patch: Partial<Task>) => setT({ ...t, ...patch });
  const sched = forecast?.base.schedule?.tasks[t.id];
  const settings = getSettings(ws);
  const cal = t.estimateMinutes
    ? suggestMultiplier(
        calibrationSamples(ws, goal.id),
        t.category,
        settings.calibration.window,
        settings.calibration.minTasks,
      )
    : null;
  const logged = ws.executionRecords
    .filter((r) => r.taskId === t.id)
    .reduce((a, r) => a + r.minutes, 0);

  const otherDeps = ws.dependencies.filter((d) => d.toTaskId !== t.id);
  const nameOf = (id: ID) => ws.tasks.find((x) => x.id === id)?.title ?? '?';

  const addPred = (fromId: ID) => {
    if (!fromId || deps.some((d) => d.fromTaskId === fromId)) return;
    const loop = cyclePathIfAdded(goalTasks, [...otherDeps, ...deps], fromId, t.id);
    if (loop) {
      const names = [...loop, loop[0]!].map((id) => `“${nameOf(id)}”`).join(' → ');
      setErrors([`That would create a loop: ${names}. A task can’t (indirectly) wait on itself.`]);
      return;
    }
    setErrors([]);
    setDeps([...deps, { id: ids.next(), fromTaskId: fromId, toTaskId: t.id, lagDays: 0 }]);
  };

  const clean = (x: Task): Task => {
    const out = { ...x };
    for (const k of Object.keys(out) as (keyof Task)[])
      if (out[k] === undefined || out[k] === '')
        if (k !== 'definitionOfDone' && k !== 'title') delete out[k];
    if (out.kind === 'wait') delete out.estimateMinutes;
    else delete out.waitDays;
    if (out.status !== 'skipped') delete out.skippedReason;
    if (out.status === 'blocked' && orig.status !== 'blocked') out.blockedAt = clock.now();
    if (out.status !== 'blocked') delete out.blockedAt;
    if (out.status === 'completed' && !out.completedAt) out.completedAt = clock.now();
    if (out.status !== 'completed') delete out.completedAt;
    if (out.intention && !out.intention.when && !out.intention.where && !out.intention.ifThen)
      delete out.intention;
    return out;
  };

  const save = async () => {
    if (!t.title.trim()) return setErrors(['The task needs a title.']);
    const r = await commit((w: Workspace) => ({
      ...w,
      tasks: upsert(w.tasks, clean({ ...t, title: t.title.trim() })),
      dependencies: [...w.dependencies.filter((d) => d.toTaskId !== t.id), ...deps],
    }));
    if (!r.ok) return setErrors(r.errors);
    props.onClose();
  };

  const doSplit = async () => {
    const titles = pieces.map((p) => p.trim()).filter(Boolean);
    if (titles.length < 2) return setErrors(['List at least two pieces.']);
    const r = await commit((w) => splitTask(w, t.id, titles, ids, clock).ws);
    if (!r.ok) return setErrors(r.errors);
    props.onClose();
  };

  const remove = async () => {
    const r = await commit((w) => ({
      ...w,
      tasks: w.tasks.filter((x) => x.id !== t.id),
      dependencies: w.dependencies.filter((d) => d.fromTaskId !== t.id && d.toTaskId !== t.id),
      executionRecords: w.executionRecords.filter((x) => x.taskId !== t.id),
      evidence: w.evidence.filter((x) => x.taskId !== t.id),
      goals: w.goals.map((g) => ({
        ...g,
        charter: {
          ...g.charter,
          premortem: g.charter.premortem.map((p) =>
            p.linkedId === t.id ? { ...p, response: 'risk' as const, linkedId: undefined } : p,
          ),
        },
      })),
    }));
    if (!r.ok) return setErrors(r.errors);
    props.onClose();
  };

  if (splitting) {
    return (
      <Sheet
        title={`Split “${orig.title}”`}
        onClose={props.onClose}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setSplitting(false)}>
              Back
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void doSplit()}
              disabled={!props.editable}
            >
              Split
            </button>
          </>
        }
      >
        <p className="prompt">What smaller pieces could each be finished in one sitting?</p>
        <p className="hint">
          They’ll run in this order. The first inherits this task’s predecessors; the last unlocks
          what this task unlocked.
        </p>
        <TaskListInput value={pieces} onChange={setPieces} label="Piece" />
        <Errors errors={errors} />
      </Sheet>
    );
  }

  const candidates = goalTasks.filter(
    (x) => x.id !== t.id && !deps.some((d) => d.fromTaskId === x.id),
  );
  return (
    <Sheet
      title={props.editable ? 'Edit task' : 'Task'}
      wide
      onClose={props.onClose}
      footer={
        props.editable ? (
          <>
            {confirmDelete ? (
              <button type="button" className="btn danger" onClick={() => void remove()}>
                Delete for good
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn ghost" onClick={props.onClose}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={() => void save()}>
              Save
            </button>
          </>
        ) : undefined
      }
    >
      <fieldset disabled={!props.editable} className="plain-fieldset editor">
        {sched && (
          <p className="muted small">
            Scheduled {sched.start ? `${fmtDate(sched.start)} → ` : ''}
            {fmtDate(sched.finish)} (base)
            {sched.critical
              ? ' · on the critical path'
              : ` · ${Math.round(sched.float)} days of slack`}
            {logged ? ` · ${fmtMinutes(logged)} logged` : ''}
          </p>
        )}
        <Field label="Title">
          {(id) => (
            <input id={id} value={t.title} onChange={(e) => set({ title: e.target.value })} />
          )}
        </Field>
        <div className="row3">
          <Field label="Kind">
            {(id) => (
              <select
                id={id}
                value={t.kind}
                onChange={(e) => set({ kind: e.target.value as Task['kind'] })}
              >
                <option value="work">Work</option>
                <option value="decision">Decision</option>
                <option value="wait">Wait (calendar time)</option>
              </select>
            )}
          </Field>
          <Field label="Milestone">
            {(id) => (
              <select
                id={id}
                value={t.milestoneId ?? ''}
                onChange={(e) =>
                  set({
                    milestoneId: e.target.value || undefined,
                    addedOutsidePlan: e.target.value ? undefined : t.addedOutsidePlan,
                  })
                }
              >
                <option value="">Inbox (unplanned)</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <select
                id={id}
                value={t.status}
                onChange={(e) => set({ status: e.target.value as Task['status'] })}
              >
                <option value="ready">Ready</option>
                <option value="inProgress">In progress</option>
                <option value="blocked">Blocked (external)</option>
                <option value="completed">Completed</option>
                <option value="skipped">Skipped</option>
              </select>
            )}
          </Field>
        </div>
        {t.status === 'skipped' && (
          <Field label="Why skip it?">
            {(id) => (
              <input
                id={id}
                value={t.skippedReason ?? ''}
                onChange={(e) => set({ skippedReason: e.target.value })}
              />
            )}
          </Field>
        )}
        {t.status === 'blocked' && (
          <Field label="What’s it waiting on?">
            {(id) => (
              <input
                id={id}
                value={t.blockerNote ?? ''}
                onChange={(e) => set({ blockerNote: e.target.value })}
              />
            )}
          </Field>
        )}
        <Field label="Done when">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={t.definitionOfDone}
              onChange={(e) => set({ definitionOfDone: e.target.value })}
            />
          )}
        </Field>

        {t.kind === 'wait' ? (
          <Field label="How long is the wait? (days: best, likely, worst)">
            {() => (
              <NumberRangeInput
                value={t.waitDays}
                labels={['Best', 'Likely', 'Worst']}
                unit="days"
                onChange={(r) => r && set({ waitDays: r })}
              />
            )}
          </Field>
        ) : (
          <div className="field">
            <span className="label">Estimate: best case, likely, worst case</span>
            <MinutesRangeInput
              value={t.estimateMinutes}
              onChange={(r) => r && set({ estimateMinutes: r })}
            />
            {cal && (
              <p className="mirror small">
                Your {cal.category === '*' ? '' : `${cal.category} `}tasks have run about{' '}
                <strong>{cal.multiplier.toFixed(1)}×</strong> your likely estimate.
              </p>
            )}
            <label className="inline-label">
              <span>Last similar thing actually took</span>
              <input
                inputMode="numeric"
                className="short"
                value={t.referenceMinutes ?? ''}
                onChange={(e) =>
                  set({
                    referenceMinutes:
                      e.target.value.trim() === '' ? undefined : Number(e.target.value),
                  })
                }
              />
              <span>min</span>
            </label>
          </div>
        )}
        <Field label="Cost, if any (best, likely, worst)">
          {() => (
            <MoneyRangeInput
              value={t.cost}
              currency={goal.currency}
              onChange={(r) => set({ cost: r ?? undefined })}
            />
          )}
        </Field>

        <div className="row3">
          <Field label="Priority">
            {(id) => (
              <select
                id={id}
                value={t.priority}
                onChange={(e) => set({ priority: Number(e.target.value) as 1 | 2 | 3 })}
              >
                <option value={1}>High</option>
                <option value={2}>Normal</option>
                <option value={3}>Low</option>
              </select>
            )}
          </Field>
          <Field label="Energy">
            {(id) => (
              <select
                id={id}
                value={t.energy}
                onChange={(e) => set({ energy: e.target.value as Task['energy'] })}
              >
                <option value="deep">Deep</option>
                <option value="shallow">Shallow</option>
              </select>
            )}
          </Field>
          <Field label="Category" hint="Groups tasks for calibration.">
            {(id) => (
              <>
                <input
                  id={id}
                  list="categories"
                  value={t.category ?? ''}
                  onChange={(e) => set({ category: e.target.value || undefined })}
                />
                <datalist id="categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </div>
        <div className="row2">
          <Field label="Can’t start before">
            {(id) => (
              <input
                id={id}
                type="date"
                value={t.earliestStart ?? ''}
                onChange={(e) => set({ earliestStart: e.target.value || undefined })}
              />
            )}
          </Field>
          <Field label="Your target date (optional)">
            {(id) => (
              <input
                id={id}
                type="date"
                value={t.targetDate ?? ''}
                onChange={(e) => set({ targetDate: e.target.value || undefined })}
              />
            )}
          </Field>
        </div>
        <fieldset className="plain-fieldset">
          <legend>When and where will you do it?</legend>
          <div className="row2">
            <input
              aria-label="When"
              placeholder="When"
              value={t.intention?.when ?? ''}
              onChange={(e) =>
                set({
                  intention: {
                    when: e.target.value,
                    where: t.intention?.where ?? '',
                    ifThen: t.intention?.ifThen,
                  },
                })
              }
            />
            <input
              aria-label="Where"
              placeholder="Where"
              value={t.intention?.where ?? ''}
              onChange={(e) =>
                set({
                  intention: {
                    when: t.intention?.when ?? '',
                    where: e.target.value,
                    ifThen: t.intention?.ifThen,
                  },
                })
              }
            />
          </div>
        </fieldset>
        {ws.assumptions.some((a) => a.goalId === goal.id) && (
          <Field label="Tests an assumption">
            {(id) => (
              <select
                id={id}
                value={t.testsAssumptionId ?? ''}
                onChange={(e) => set({ testsAssumptionId: e.target.value || undefined })}
              >
                <option value="">None</option>
                {ws.assumptions
                  .filter((a) => a.goalId === goal.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.statement}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        )}

        <div className="field">
          <span className="label">Has to happen first</span>
          {deps.length === 0 && <p className="muted small">Nothing yet.</p>}
          <ul className="dep-list">
            {deps.map((d) => (
              <li key={d.id}>
                <span>{nameOf(d.fromTaskId)}</span>
                <label className="inline-label">
                  <span>then wait</span>
                  <input
                    className="short"
                    inputMode="numeric"
                    aria-label={`Lag days after ${nameOf(d.fromTaskId)}`}
                    value={d.lagDays}
                    onChange={(e) =>
                      setDeps(
                        deps.map((x) =>
                          x.id === d.id
                            ? { ...x, lagDays: Math.max(0, Number(e.target.value) || 0) }
                            : x,
                        ),
                      )
                    }
                  />
                  <span>days</span>
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${nameOf(d.fromTaskId)}`}
                  onClick={() => setDeps(deps.filter((x) => x.id !== d.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {candidates.length > 0 && (
            <select
              aria-label="Add a predecessor"
              value=""
              onChange={(e) => addPred(e.target.value)}
            >
              <option value="">+ Add something that has to happen first…</option>
              {candidates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
          )}
        </div>
        <Errors errors={errors} />
        {props.editable && t.kind !== 'wait' && (
          <button type="button" className="link-btn" onClick={() => setSplitting(true)}>
            Split into smaller pieces…
          </button>
        )}
      </fieldset>
    </Sheet>
  );
}

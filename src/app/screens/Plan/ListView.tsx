import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../../store';
import { useForecast, useStuck } from '../../derived';
import type { Assumption, ID, Milestone, Task, Workspace } from '../../../core/model/types';
import {
  milestonesOfGoal,
  newMilestone,
  newTask,
  tasksOfGoal,
  tasksOfMilestone,
  upsert,
} from '../../../core/model/factories';
import { readyTaskIds } from '../../../core/engines/nextAction';
import { TaskEditor } from './TaskEditor';
import { Errors, Sheet } from '../../components/Sheet';
import { Field, NumberRangeInput } from '../../components/inputs';
import { fmtDate, fmtMinutesRange } from '../../format';

export type TaskState = 'completed' | 'skipped' | 'inProgress' | 'blocked' | 'ready' | 'future';

export function taskState(t: Task, ready: Set<ID>): TaskState {
  if (
    t.status === 'completed' ||
    t.status === 'skipped' ||
    t.status === 'blocked' ||
    t.status === 'inProgress'
  )
    return t.status;
  return ready.has(t.id) ? 'ready' : 'future';
}

export const STATE_LABEL: Record<TaskState, string> = {
  completed: 'Done',
  skipped: 'Skipped',
  inProgress: 'In progress',
  blocked: 'Blocked',
  ready: 'Ready',
  future: 'Waiting',
};

export function ListView({ editable }: { editable: boolean }) {
  const { ws, goal, commit, ids, clock } = useStore();
  const { forecast } = useForecast();
  const stuck = useStuck();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<{ id: ID; split?: boolean } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [newMs, setNewMs] = useState('');

  useEffect(() => {
    const id = params.get('task');
    if (id && ws.tasks.some((t) => t.id === id)) {
      setEditing({ id, split: params.get('split') === '1' });
      setParams({}, { replace: true });
    }
  }, [params, setParams, ws.tasks]);

  if (!goal) return null;
  const milestones = milestonesOfGoal(ws, goal.id);
  const tasks = tasksOfGoal(ws, goal.id);
  const ready = readyTaskIds(tasks, ws.dependencies, clock.today());
  const inbox = tasks
    .filter((t) => !t.milestoneId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const sched = forecast?.base.schedule;
  const run = async (fn: (w: Workspace) => Workspace) => {
    const r = await commit(fn);
    setErrors(r.ok ? [] : r.errors);
    return r.ok;
  };

  const move = (m: Milestone, dir: -1 | 1) => {
    const i = milestones.findIndex((x) => x.id === m.id);
    const other = milestones[i + dir];
    if (!other) return;
    void run((w) => ({
      ...w,
      milestones: upsert(upsert(w.milestones, { ...m, order: other.order }), {
        ...other,
        order: m.order,
      }),
    }));
  };

  return (
    <div className="list-view">
      <Errors errors={errors} />
      {milestones.length === 0 && <p className="muted">No milestones yet.</p>}
      <div>
        {milestones.map((m, i) => (
          <MilestoneCard
            key={m.id}
            m={m}
            first={i === 0}
            last={i === milestones.length - 1}
            tasks={tasksOfMilestone(ws, m.id)}
            ready={ready}
            stuck={stuck}
            modeled={sched?.milestones[m.id] ?? null}
            critical={(id) => !!sched?.tasks[id]?.critical}
            onEdit={(id) => setEditing({ id })}
            onMove={(d) => move(m, d)}
            onRun={run}
            editable={editable}
            onAddBefore={(title) =>
              run((w) => ({
                ...w,
                milestones: [
                  ...w.milestones.map((x) =>
                    x.goalId === goal.id && x.order >= m.order ? { ...x, order: x.order + 1 } : x,
                  ),
                  newMilestone(ids, goal.id, title, m.order),
                ],
              }))
            }
            onAddTask={(title) =>
              run((w) => ({
                ...w,
                tasks: [...w.tasks, newTask(ids, clock, goal.id, title, { milestoneId: m.id })],
              }))
            }
          />
        ))}
        {editable && (
          <form
            className="add-row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newMs.trim()) return;
              const max = milestones.length ? Math.max(...milestones.map((x) => x.order)) + 1 : 0;
              if (
                await run((w) => ({
                  ...w,
                  milestones: [...w.milestones, newMilestone(ids, goal.id, newMs.trim(), max)],
                }))
              )
                setNewMs('');
            }}
          >
            <input
              aria-label="New milestone at the end"
              placeholder="+ Milestone at the end (a state of the world)"
              value={newMs}
              onChange={(e) => setNewMs(e.target.value)}
            />
          </form>
        )}

        {inbox.length > 0 && (
          <section className="card ms inbox">
            <header className="ms-head">
              <h3>Inbox</h3>
              <span className="muted small">
                Captured outside planning. Place them in a milestone.
              </span>
            </header>
            <ul className="task-rows">
              {inbox.map((t) => (
                <TaskRow
                  key={t.id}
                  t={t}
                  state={taskState(t, ready)}
                  stuck={!!stuck[t.id]}
                  critical={false}
                  onEdit={() => setEditing({ id: t.id })}
                />
              ))}
            </ul>
          </section>
        )}

        <Assumptions editable={editable} run={run} />
      </div>
      {editing && (
        <TaskEditor
          taskId={editing.id}
          editable={editable}
          startWithSplit={editing.split}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function MilestoneCard(props: {
  m: Milestone;
  first: boolean;
  last: boolean;
  tasks: Task[];
  ready: Set<ID>;
  stuck: Record<ID, unknown>;
  modeled: string | null;
  critical: (id: ID) => boolean;
  editable: boolean;
  onEdit: (id: ID) => void;
  onMove: (d: -1 | 1) => void;
  onRun: (fn: (w: Workspace) => Workspace) => Promise<boolean>;
  onAddBefore: (title: string) => Promise<boolean>;
  onAddTask: (title: string) => Promise<boolean>;
}) {
  const { m, tasks } = props;
  const [title, setTitle] = useState(m.title);
  const [dod, setDod] = useState(m.definitionOfDone);
  const [newTitle, setNewTitle] = useState('');
  const [before, setBefore] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const live = tasks.filter((t) => t.status !== 'skipped');
  const total = live.reduce((a, t) => a + (t.estimateMinutes?.base ?? 0), 0);
  const done = live
    .filter((t) => t.status === 'completed')
    .reduce((a, t) => a + (t.estimateMinutes?.base ?? 0), 0);
  const pct = total
    ? Math.round((done / total) * 100)
    : live.length && live.every((t) => t.status === 'completed')
      ? 100
      : 0;
  const save = (patch: Partial<Milestone>) =>
    props.onRun((w) => ({ ...w, milestones: upsert(w.milestones, { ...m, ...patch }) }));
  return (
    <section className="card ms" aria-label={`Milestone: ${m.title}`}>
      <header className="ms-head">
        {props.editable ? (
          <input
            className="ms-title"
            aria-label="Milestone title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== m.title && void save({ title: title.trim() })}
          />
        ) : (
          <h3 className="ms-title-ro">{m.title}</h3>
        )}
        {props.editable && (
          <div className="ms-tools">
            <button
              type="button"
              className="icon-btn"
              aria-label="Move earlier"
              disabled={props.first}
              onClick={() => props.onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Move later"
              disabled={props.last}
              onClick={() => props.onMove(1)}
            >
              ↓
            </button>
            {confirmDel ? (
              <button
                type="button"
                className="btn danger small"
                onClick={() =>
                  void props.onRun((w) => ({
                    ...w,
                    milestones: w.milestones.filter((x) => x.id !== m.id),
                    tasks: w.tasks.map((t) =>
                      t.milestoneId === m.id ? { ...t, milestoneId: undefined } : t,
                    ),
                    revenueStreams: w.revenueStreams.map((r) =>
                      r.startsAfterMilestoneId === m.id
                        ? { ...r, startsAfterMilestoneId: undefined }
                        : r,
                    ),
                    goals: w.goals.map((g) => ({
                      ...g,
                      charter: {
                        ...g.charter,
                        commitments: g.charter.commitments.filter(
                          (c) =>
                            !(
                              c.rule?.kind === 'maxSpendBeforeMilestone' &&
                              c.rule.milestoneId === m.id
                            ),
                        ),
                      },
                    })),
                  }))
                }
              >
                Delete (tasks go to inbox)
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn"
                aria-label="Delete milestone"
                onClick={() => setConfirmDel(true)}
              >
                ⌫
              </button>
            )}
          </div>
        )}
      </header>
      <div className="ms-meta">
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress by estimated minutes"
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="muted small">
          {pct}% · modeled {fmtDate(props.modeled)}
        </span>
      </div>
      {props.editable ? (
        <input
          className="ms-dod"
          aria-label="Milestone done when"
          placeholder="Done when…"
          value={dod}
          onChange={(e) => setDod(e.target.value)}
          onBlur={() => dod !== m.definitionOfDone && void save({ definitionOfDone: dod })}
        />
      ) : (
        m.definitionOfDone && <p className="ms-dod-ro">Done when: {m.definitionOfDone}</p>
      )}
      <ul className="task-rows">
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            t={t}
            state={taskState(t, props.ready)}
            stuck={!!props.stuck[t.id]}
            critical={props.critical(t.id)}
            onEdit={() => props.onEdit(t.id)}
          />
        ))}
      </ul>
      {props.editable && (
        <form
          className="add-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (newTitle.trim() && (await props.onAddTask(newTitle.trim()))) setNewTitle('');
          }}
        >
          <input
            aria-label={`New task in ${m.title}`}
            placeholder="+ Task (start with a verb)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
        </form>
      )}
      {props.editable &&
        (before === null ? (
          <button type="button" className="link-btn small" onClick={() => setBefore('')}>
            What has to be true just before this?
          </button>
        ) : (
          <form
            className="add-row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (before.trim() && (await props.onAddBefore(before.trim()))) setBefore(null);
            }}
          >
            <input
              autoFocus
              aria-label={`Milestone before ${m.title}`}
              placeholder="A milestone that comes just before"
              value={before}
              onChange={(e) => setBefore(e.target.value)}
            />
          </form>
        ))}
    </section>
  );
}

function TaskRow({
  t,
  state,
  stuck,
  critical,
  onEdit,
}: {
  t: Task;
  state: TaskState;
  stuck: boolean;
  critical: boolean;
  onEdit: () => void;
}) {
  return (
    <li>
      <button type="button" className={`task-row st-${state}`} onClick={onEdit}>
        <span className={`dot st-${state}`} aria-hidden="true" />
        <span className="task-title">{t.title}</span>
        <span className="task-meta">
          {critical && state !== 'completed' && <span className="badge crit">critical</span>}
          {stuck && <span className="badge stuck">stuck</span>}
          <span className="muted small">
            {t.kind === 'wait'
              ? `wait ${t.waitDays ? `${t.waitDays.base} d` : '?'}`
              : fmtMinutesRange(t.estimateMinutes)}
          </span>
          <span className="sr-only">{STATE_LABEL[state]}</span>
        </span>
      </button>
    </li>
  );
}

function Assumptions({
  editable,
  run,
}: {
  editable: boolean;
  run: (fn: (w: Workspace) => Workspace) => Promise<boolean>;
}) {
  const { ws, goal, ids, clock } = useStore();
  const [editing, setEditing] = useState<Assumption | null>(null);
  const [text, setText] = useState('');
  if (!goal) return null;
  const list = ws.assumptions.filter((a) => a.goalId === goal.id);
  return (
    <section className="card ms assumptions">
      <header className="ms-head">
        <h3>Assumptions</h3>
        <span className="muted small">Things that have to be true. Test the risky ones early.</span>
      </header>
      <ul className="task-rows">
        {list.map((a) => {
          const tests = ws.tasks.filter((t) => t.testsAssumptionId === a.id).length;
          return (
            <li key={a.id}>
              <button type="button" className="task-row" onClick={() => setEditing(a)}>
                <span className={`dot as-${a.status}`} aria-hidden="true" />
                <span className="task-title">{a.statement}</span>
                <span className="task-meta muted small">
                  {a.status} · {a.confidence} confidence · {tests} test{tests === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {editable && (
        <form
          className="add-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            const a: Assumption = {
              id: ids.next(),
              goalId: goal.id,
              statement: text.trim(),
              confidence: 'medium',
              status: 'untested',
              history: [{ at: clock.now(), status: 'untested' }],
            };
            if (await run((w) => ({ ...w, assumptions: [...w.assumptions, a] }))) setText('');
          }}
        >
          <input
            aria-label="New assumption"
            placeholder="+ Assumption (e.g. “People will pay for …”)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </form>
      )}
      {editing && (
        <AssumptionEditor
          a={editing}
          editable={editable}
          run={run}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function AssumptionEditor({
  a,
  editable,
  run,
  onClose,
}: {
  a: Assumption;
  editable: boolean;
  run: (fn: (w: Workspace) => Workspace) => Promise<boolean>;
  onClose: () => void;
}) {
  const { clock } = useStore();
  const [d, setD] = useState(a);
  return (
    <Sheet
      title="Assumption"
      onClose={onClose}
      footer={
        editable ? (
          <>
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                if (
                  await run((w) => ({
                    ...w,
                    assumptions: w.assumptions.filter((x) => x.id !== a.id),
                    tasks: w.tasks.map((t) =>
                      t.testsAssumptionId === a.id ? { ...t, testsAssumptionId: undefined } : t,
                    ),
                  }))
                )
                  onClose();
              }}
            >
              Delete
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                const changed =
                  d.status !== a.status || JSON.stringify(d.value) !== JSON.stringify(a.value);
                const next = {
                  ...d,
                  history: changed
                    ? [
                        ...a.history,
                        {
                          at: clock.now(),
                          status: d.status,
                          ...(d.value ? { value: d.value } : {}),
                        },
                      ]
                    : a.history,
                };
                if (!next.value) delete next.value;
                if (await run((w) => ({ ...w, assumptions: upsert(w.assumptions, next) })))
                  onClose();
              }}
            >
              Save
            </button>
          </>
        ) : undefined
      }
    >
      <fieldset disabled={!editable} className="plain-fieldset">
        <Field label="Statement">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={d.statement}
              onChange={(e) => setD({ ...d, statement: e.target.value })}
            />
          )}
        </Field>
        <div className="row2">
          <Field label="Confidence">
            {(id) => (
              <select
                id={id}
                value={d.confidence}
                onChange={(e) =>
                  setD({ ...d, confidence: e.target.value as Assumption['confidence'] })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <select
                id={id}
                value={d.status}
                onChange={(e) => setD({ ...d, status: e.target.value as Assumption['status'] })}
              >
                <option value="untested">Untested</option>
                <option value="supported">Supported</option>
                <option value="contradicted">Contradicted</option>
                <option value="revised">Revised</option>
              </select>
            )}
          </Field>
        </div>
        <Field label="A value, if it has one (low, base, high)">
          {() => (
            <NumberRangeInput
              value={d.value}
              onChange={(r) => setD({ ...d, value: r ?? undefined })}
            />
          )}
        </Field>
        <Field label="Unit">
          {(id) => (
            <input
              id={id}
              value={d.unit ?? ''}
              onChange={(e) => setD({ ...d, unit: e.target.value || undefined })}
            />
          )}
        </Field>
      </fieldset>
    </Sheet>
  );
}

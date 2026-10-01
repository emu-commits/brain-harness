import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useStore, withSettings } from '../../store';
import { useSessionApi } from '../../session';
import { useForecast, useGoalTasks, useStuck } from '../../derived';
import { readyTaskIds, selectNextAction } from '../../../core/engines/nextAction';
import { assembleContext } from '../../../core/harness/context';
import { charterLine, sessionStartHook } from '../../../core/harness/hooks';
import { activeSession } from '../../../core/harness/sessions';
import type { StuckReason } from '../../../core/harness/stuck';
import { capacityOf, newTask } from '../../../core/model/factories';
import type { ID, MemoryEntry, Task } from '../../../core/model/types';
import { diffDays } from '../../../core/util/dates';
import { fmtDate, fmtDays, fmtMinutes, fmtMinutesRange } from '../../format';
import { WhySheet } from '../../components/WhySheet';
import type { Trace } from '../../../core/engines/scenarios';
import { cancelRunning, patchTask } from '../../actions';
import { RunningCard, PreTaskSheet, PostTaskSheet } from './TaskRun';
import type { SittingResult } from './TaskRun';
import { ObstacleMoment, ProgressCard, TodaysPlan, WoopRitual } from './Woop';
import { obstacleMomentAvailable, todaysPlan, woopDue } from '../../../core/harness/woop';
import { milestoneProgress } from '../../../core/engines/progress';
import { Errors, Sheet } from '../../components/Sheet';

export function Today() {
  const { ws, goal, clock, settings, commit } = useStore();
  const { forecast } = useForecast();
  const { tasks, deps } = useGoalTasks();
  const stuck = useStuck();
  const loc = useLocation();
  const today = clock.today();
  const [picked, setPicked] = useState<ID | null>(null);
  const [sheet, setSheet] = useState<null | 'pick' | 'pre' | 'post'>(null);
  const [why, setWhy] = useState<{ value: string; trace: Trace } | null>(null);
  const [post, setPost] = useState<{ complete: boolean } | null>(null);
  const [tiny, setTiny] = useState<{ taskId: ID; focus: string } | null>(null);
  const [celebrate, setCelebrate] = useState<SittingResult['progress'] | null>(null);

  const running =
    settings.running && ws.tasks.some((t) => t.id === settings.running!.taskId)
      ? settings.running
      : undefined;
  const base = forecast?.base;
  const ready = useMemo(() => readyTaskIds(tasks, deps, today), [tasks, deps, today]);
  const next = useMemo(
    () =>
      goal
        ? selectNextAction({
            tasks,
            dependencies: deps,
            scheduleOrder: base?.schedule?.order,
            today,
            capacity: capacityOf(ws, goal.id),
            local: clock.localTime(),
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, deps, base, today, goal, ws.capacities],
  );
  const currentId = running?.taskId ?? (picked && ready.has(picked) ? picked : next?.taskId);
  const ctx =
    goal && currentId
      ? assembleContext(ws, 'execute', { goalId: goal.id, taskId: currentId, today })
      : null;
  const hook = goal ? sessionStartHook(ws, goal.id, clock.now()) : null;
  const showResume =
    !!hook?.resume && settings.resumeAckFor !== hook.resume.lastSessionId && !activeSession(ws);

  if (!goal) return null;
  if (showResume)
    return (
      <ResumeCard
        daysAway={hook!.resume!.daysAway}
        note={hook!.resume!.handoffNote}
        lastSessionId={hook!.resume!.lastSessionId}
        nextTaskId={next?.taskId}
        onStartTiny={(taskId, focus) => setTiny({ taskId, focus })}
      />
    );

  const blocked = tasks.filter((t) => t.status === 'blocked').length;
  const stuckIds = Object.keys(stuck);
  const moreReady = [...ready].filter((id) => id !== currentId).length;
  const firstRun = (loc.state as { firstRun?: boolean } | null)?.firstRun;
  const openTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
  const currentTask = ws.tasks.find((t) => t.id === currentId);
  const tinyTask = tiny ? ws.tasks.find((t) => t.id === tiny.taskId) : undefined;
  const planToday = todaysPlan(ws, goal.id, today);
  const showWoop = !running && !celebrate && !tiny && woopDue(ws, goal.id, clock.now());
  const msProgress = currentTask?.milestoneId
    ? milestoneProgress(ws, currentTask.milestoneId)
    : null;
  const doneCount = tasks.filter((t) => t.status === 'completed').length;
  const onSittingDone = (result: SittingResult, taskId: ID) => {
    setSheet(null);
    setPicked(null);
    if (result.progress) setCelebrate(result.progress);
    if (result.tiny) setTiny({ taskId, focus: result.tiny });
  };

  return (
    <div className="page today">
      {/* During the check-in the charter is revealed step by step, so the summary line waits. */}
      {!showWoop && charterLine(goal) && <p className="charter-line">{charterLine(goal)}</p>}
      {planToday && <TodaysPlan plan={planToday.plan} />}
      {showWoop && <WoopRitual />}
      {ctx?.handoff && !running && (
        <p className="handoff">
          <span className="muted">Last time:</span> “{ctx.handoff}”
        </p>
      )}

      {celebrate ? (
        <ProgressCard
          progress={celebrate.progress}
          minutes={celebrate.minutes}
          estimateBase={celebrate.estimateBase}
          onClose={() => setCelebrate(null)}
        />
      ) : running && currentTask ? (
        <RunningCard
          task={currentTask}
          startedAt={running.startedAt}
          predicted={running.predictedMinutes}
          focus={running.focus}
          onStop={(complete) => (setPost({ complete }), setSheet('post'))}
        />
      ) : ctx ? (
        <section className="card next" aria-labelledby="next-title">
          <p className="eyebrow">{picked && picked !== next?.taskId ? 'Your pick' : 'Next'}</p>
          <h1 id="next-title" className="next-title">
            {ctx.task.title}
          </h1>
          <dl className="ctx">
            <div>
              <dt>Done when</dt>
              <dd>
                {ctx.task.definitionOfDone || (
                  <em className="muted">not defined yet — you’ll write it when you start</em>
                )}
              </dd>
            </div>
            <p className="ctx-meta">
              {[
                fmtMinutesRange(ctx.task.estimateMinutes),
                ctx.unlocks.count > 0
                  ? `unlocks ${ctx.unlocks.count} task${ctx.unlocks.count === 1 ? '' : 's'}`
                  : '',
                [ctx.task.intention?.when, ctx.task.intention?.where].filter(Boolean).join(', '),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {msProgress && !msProgress.reached && (
              <div className="ms-gradient">
                <div
                  className="progress"
                  role="progressbar"
                  aria-valuenow={msProgress.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${msProgress.title} progress`}
                >
                  <span style={{ width: `${msProgress.pct}%` }} />
                </div>
                <span className="muted small">
                  {msProgress.title} · {msProgress.doneTasks} of {msProgress.totalTasks} done
                </span>
              </div>
            )}
            {ctx.resolved.length > 0 && (
              <div>
                <dt>Just resolved</dt>
                <dd>{ctx.resolved.map((r) => r.title).join(', ')}</dd>
              </div>
            )}
            {ctx.unlocks.titles.length > 0 && (
              <div>
                <dt>Unlocks</dt>
                <dd>{ctx.unlocks.titles.join(' · ')}</dd>
              </div>
            )}
            {ctx.assumption && (
              <div>
                <dt>Tests the assumption</dt>
                <dd>{ctx.assumption.statement}</dd>
              </div>
            )}
          </dl>
          <div className="next-actions">
            <button type="button" className="btn primary big" onClick={() => setSheet('pre')}>
              Start
            </button>
            {ready.size > 1 && (
              <button type="button" className="link-btn" onClick={() => setSheet('pick')}>
                Pick a different task
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="card empty">
          {openTasks.length ? (
            <>
              <h1>Nothing is ready to start right now.</h1>
              <p className="muted">
                Every open task is waiting on something: a predecessor, a start date, or a blocker.
              </p>
            </>
          ) : (
            <>
              <h1>No open tasks.</h1>
              <p className="muted">What’s the next concrete action? Add it in a Plan session.</p>
            </>
          )}
          <Link className="btn" to="/plan">
            Open Plan
          </Link>
        </section>
      )}

      <p className="counts">
        {moreReady} more ready · {blocked} blocked · {stuckIds.length} stuck
      </p>

      {stuckIds.length > 0 && !running && !celebrate && (
        <StuckCards
          ids={stuckIds}
          stuck={stuck}
          onStartTiny={(taskId, focus) => setTiny({ taskId, focus })}
        />
      )}

      {base && <ForecastLine goalTarget={goal.targetDate} onWhy={setWhy} />}

      {firstRun && (
        <p className="nudge">
          <Link to="/plan">Plan more when you’re ready →</Link>
        </p>
      )}

      {doneCount > 0 && !celebrate && (
        <p className="nudge">
          <Link to="/done">What you’ve done ({doneCount}) →</Link>
        </p>
      )}

      {!running && <Capture />}

      {sheet === 'pick' && (
        <PickSheet
          ids={[...ready]}
          current={currentId}
          onPick={(id) => {
            setPicked(id);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'pre' && currentTask && (
        <PreTaskSheet task={currentTask} onClose={() => setSheet(null)} />
      )}
      {tiny && tinyTask && !running && (
        <PreTaskSheet task={tinyTask} focus={tiny.focus} onClose={() => setTiny(null)} />
      )}
      {sheet === 'post' && running && currentTask && post && (
        <PostTaskSheet
          task={currentTask}
          startedAt={running.startedAt}
          complete={post.complete}
          predicted={running.predictedMinutes}
          onClose={() => setSheet(null)}
          onDone={(result) => onSittingDone(result, currentTask.id)}
        />
      )}
      {why && <WhySheet value={why.value} trace={why.trace} ws={ws} onClose={() => setWhy(null)} />}
      {settings.running && !running && <OrphanTimer onClear={() => void commit(cancelRunning)} />}
    </div>
  );
}

function OrphanTimer({ onClear }: { onClear: () => void }) {
  useEffect(() => {
    onClear();
  }, [onClear]);
  return null;
}

function ForecastLine({
  goalTarget,
  onWhy,
}: {
  goalTarget: string;
  onWhy: (w: { value: string; trace: Trace }) => void;
}) {
  const { forecast } = useForecast();
  if (!forecast) return null;
  const { base, conservative, optimistic } = forecast;
  if (base.scheduleError?.kind === 'noCapacity') {
    return (
      <p className="forecast-line">
        <span className="muted">Forecast:</span>{' '}
        <Link to="/plan/questions">How many hours a week can you give this?</Link>
      </p>
    );
  }
  if (base.scheduleError?.kind === 'cycle')
    return (
      <p className="forecast-line warn">
        Forecast unavailable: some tasks depend on each other in a loop.
      </p>
    );
  if (!base.goalCompletion) {
    return (
      <p className="forecast-line">
        <span className="muted">Forecast:</span> {base.goalCompletionNote}
      </p>
    );
  }
  const slack = diffDays(base.goalCompletion, goalTarget);
  const trace = base.traces.goalCompletion!;
  return (
    <section className="forecast-line" aria-label="Forecast">
      <button
        type="button"
        className="value-btn"
        onClick={() => onWhy({ value: fmtDate(base.goalCompletion), trace })}
      >
        <span className="muted">Modeled finish (base)</span>{' '}
        <strong>{fmtDate(base.goalCompletion)}</strong>
      </button>
      <span className="muted small">
        {slack >= 0
          ? `${fmtDays(slack)} before your target`
          : `${fmtDays(slack)} after your target`}
        {conservative.goalCompletion &&
          optimistic.goalCompletion &&
          optimistic.goalCompletion !== conservative.goalCompletion && (
            <>
              {' · range '}
              <button
                type="button"
                className="value-btn inline"
                onClick={() =>
                  onWhy({
                    value: fmtDate(optimistic.goalCompletion),
                    trace: optimistic.traces.goalCompletion!,
                  })
                }
              >
                {fmtDate(optimistic.goalCompletion)}
              </button>
              {' – '}
              <button
                type="button"
                className="value-btn inline"
                onClick={() =>
                  onWhy({
                    value: fmtDate(conservative.goalCompletion),
                    trace: conservative.traces.goalCompletion!,
                  })
                }
              >
                {fmtDate(conservative.goalCompletion)}
              </button>
            </>
          )}
      </span>
    </section>
  );
}

function ResumeCard({
  daysAway,
  note,
  lastSessionId,
  nextTaskId,
  onStartTiny,
}: {
  daysAway: number;
  note: string | null;
  lastSessionId: ID;
  nextTaskId?: ID;
  onStartTiny: (taskId: ID, focus: string) => void;
}) {
  const { ws, commit, goal, ids, clock } = useStore();
  const navigate = useNavigate();
  const [changed, setChanged] = useState(false);
  const [text, setText] = useState('');
  const ack = (extra?: MemoryEntry) =>
    commit((w) =>
      withSettings(extra ? { ...w, memory: [...w.memory, extra] } : w, {
        resumeAckFor: lastSessionId,
      }),
    );
  return (
    <div className="page today">
      <section className="card resume" aria-labelledby="resume-title">
        <p className="eyebrow">Welcome back · {fmtDays(daysAway)} away</p>
        <h1 id="resume-title">
          {note ? 'Here’s where you left off' : 'Picking the thread back up'}
        </h1>
        {note ? (
          <blockquote className="handoff-quote">{note}</blockquote>
        ) : (
          <p className="muted">You didn’t leave a handoff note last time.</p>
        )}
        {!changed && nextTaskId && obstacleMomentAvailable(ws, goal!.id, undefined) && (
          <ObstacleMoment
            trigger="resume"
            taskId={nextTaskId}
            startLabel="Start with this"
            onStartTiny={async (focus) => {
              await ack();
              onStartTiny(nextTaskId, focus);
            }}
          />
        )}
        {!changed ? (
          <>
            <p className="prompt">Has anything changed since then?</p>
            <div className="row-actions">
              <button type="button" className="btn primary" onClick={() => void ack()}>
                Nothing changed
              </button>
              <button type="button" className="btn" onClick={() => setChanged(true)}>
                Something changed
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="prompt" htmlFor="changed">
              What changed?
            </label>
            <textarea
              id="changed"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="row-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  void ack(
                    text.trim()
                      ? {
                          id: ids.next(),
                          goalId: goal!.id,
                          kind: 'decision',
                          text: text.trim(),
                          createdAt: clock.now(),
                          sessionId: lastSessionId,
                        }
                      : undefined,
                  )
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await ack(
                    text.trim()
                      ? {
                          id: ids.next(),
                          goalId: goal!.id,
                          kind: 'decision',
                          text: text.trim(),
                          createdAt: clock.now(),
                          sessionId: lastSessionId,
                        }
                      : undefined,
                  );
                  navigate('/plan');
                }}
              >
                Save and open Plan
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function PickSheet({
  ids,
  current,
  onPick,
  onClose,
}: {
  ids: ID[];
  current?: ID;
  onPick: (id: ID) => void;
  onClose: () => void;
}) {
  const { ws } = useStore();
  const { forecast } = useForecast();
  const order = forecast?.base.schedule?.order ?? [];
  const sorted = [...ids].sort(
    (a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9),
  );
  return (
    <Sheet title="Pick a task" onClose={onClose}>
      <ul className="pick-list">
        {sorted.map((id) => {
          const t = ws.tasks.find((x) => x.id === id)!;
          return (
            <li key={id}>
              <button
                type="button"
                className={`pick ${id === current ? 'on' : ''}`}
                onClick={() => onPick(id)}
              >
                <span className="pick-title">{t.title}</span>
                <span className="muted small">
                  {fmtMinutesRange(t.estimateMinutes)} · {t.energy}
                  {forecast?.base.schedule?.tasks[id]?.critical ? ' · on the critical path' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

const STUCK_TEXT: Record<StuckReason['kind'], (r: StuckReason) => string> = {
  sessions: (r) =>
    `in progress across ${(r as { count: number }).count} sessions without new evidence`,
  overrun: (r) =>
    `${fmtMinutes((r as { loggedMinutes: number }).loggedMinutes)} logged, past 1.5× your worst case`,
  blocked: (r) => `blocked for ${(r as { days: number }).days} days`,
};

function StuckCards({
  ids,
  stuck,
  onStartTiny,
}: {
  ids: ID[];
  stuck: Record<ID, StuckReason[]>;
  onStartTiny: (taskId: ID, focus: string) => void;
}) {
  const { ws, commit, clock, goal, session } = useStore();
  // The if-then is offered on the first stuck card only, once per session.
  const offer = !!goal && obstacleMomentAvailable(ws, goal.id, session?.id);
  const api = useSessionApi();
  const navigate = useNavigate();
  const [open, setOpen] = useState<{ id: ID; action: 'blocker' | 'delegate' | 'drop' } | null>(
    null,
  );
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const apply = async (patch: Partial<Task>, clear: (keyof Task)[] = []) => {
    if (!(await api.ensure('execute'))) return;
    const r = await commit((w) => patchTask(w, open!.id, patch, clear));
    if (!r.ok) return setErrors(r.errors);
    setOpen(null);
    setText('');
  };
  return (
    <section className="stuck-list" aria-label="Stuck tasks">
      {ids.map((id, i) => {
        const t = ws.tasks.find((x) => x.id === id)!;
        return (
          <article key={id} className="card stuck">
            <p className="eyebrow">This has been open a while</p>
            <h2>{t.title}</h2>
            <p className="muted small">
              {stuck[id]!.map((r) => STUCK_TEXT[r.kind](r)).join(' · ')}
            </p>
            {offer && i === 0 && t.status !== 'blocked' && (
              <ObstacleMoment
                trigger="stuck"
                taskId={id}
                onStartTiny={(focus) => onStartTiny(id, focus)}
              />
            )}
            <p className="prompt">What would help?</p>
            <div className="chips">
              <button
                type="button"
                className="chip"
                onClick={() => navigate(`/plan/list?task=${id}&split=1`)}
              >
                Split it
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => navigate(`/plan/list?task=${id}`)}
              >
                Change approach
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setOpen({ id, action: 'blocker' })}
              >
                Name the blocker
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setOpen({ id, action: 'delegate' })}
              >
                Delegate
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setOpen({ id, action: 'drop' })}
              >
                Drop it
              </button>
            </div>
            {open?.id === id && (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim()) return setErrors(['Write a few words.']);
                  if (open.action === 'blocker')
                    void apply({
                      status: 'blocked',
                      blockerNote: text.trim(),
                      blockedAt: clock.now(),
                    });
                  if (open.action === 'delegate') void apply({ delegatedTo: text.trim() });
                  if (open.action === 'drop')
                    void apply({ status: 'skipped', skippedReason: text.trim() });
                }}
              >
                <label htmlFor={`stuck-${id}`}>
                  {open.action === 'blocker'
                    ? 'What’s it waiting on?'
                    : open.action === 'delegate'
                      ? 'Who could take it?'
                      : 'Why drop it? (for future-you)'}
                </label>
                <input
                  id={`stuck-${id}`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                />
                <Errors errors={errors} />
                <div className="row-actions">
                  <button type="submit" className="btn primary">
                    Save
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </article>
        );
      })}
    </section>
  );
}

/** Execute mode can capture unplanned tasks to the inbox; Plan sessions place them. */
function Capture() {
  const { commit, goal, ids, clock } = useStore();
  const api = useSessionApi();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  if (!open) {
    return (
      <button type="button" className="link-btn capture-btn" onClick={() => setOpen(true)}>
        + Capture a task for later
      </button>
    );
  }
  return (
    <form
      className="card capture"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return setErrors(['Name the task.']);
        if (!(await api.ensure('execute'))) return;
        const r = await commit((w) => ({
          ...w,
          tasks: [
            ...w.tasks,
            newTask(ids, clock, goal!.id, title.trim(), { addedOutsidePlan: true }),
          ],
        }));
        if (!r.ok) return setErrors(r.errors);
        setTitle('');
        setOpen(false);
      }}
    >
      <label htmlFor="capture">Capture to the inbox</label>
      <p className="hint">It won’t change the plan until you place it in a Plan session.</p>
      <input id="capture" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <Errors errors={errors} />
      <div className="row-actions">
        <button type="submit" className="btn primary">
          Capture
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

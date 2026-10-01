import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store';
import { parseIfThen } from '../../../core/harness/woop';
import type { CompletionProgress } from '../../../core/engines/progress';
import type { CheckIn, ID } from '../../../core/model/types';
import { saveCheckIn } from '../../actions';
import { fmtMinutes } from '../../format';

// WOOP as a practice: a short ritual every few days, the user's own if-then shown back at the
// moments it was written for, and progress made visible. The app supplies the moment and the
// question; every word is the user's.

/** "When X, I will Y" with the two halves emphasised; falls back to the text as written. */
export function IfThenLine({ text }: { text: string }) {
  const p = parseIfThen(text);
  if (!p) return <span className="ifthen-line">{text}</span>;
  return (
    <span className="ifthen-line">
      When <em>{p.when}</em>, I will <strong>{p.then}</strong>
    </span>
  );
}

function useCheckInWriter() {
  const { commit, goal, session, ids, clock } = useStore();
  return (patch: Partial<CheckIn> & Pick<CheckIn, 'kind'>, id?: ID) => {
    const c: CheckIn = {
      id: id ?? ids.next(),
      goalId: goal!.id,
      at: clock.now(),
      day: clock.today(),
      ...(session ? { sessionId: session.id } : {}),
      ...patch,
    };
    return commit((w) => saveCheckIn(w, c)).then((r) => (r.ok ? c : null));
  };
}

type Step = 'outcome' | 'obstacle' | 'plan' | 'revise';

/** Session-start WOOP ritual: picture the outcome, name today's obstacle, re-commit to the plan. */
export function WoopRitual() {
  const { goal } = useStore();
  const write = useCheckInWriter();
  const [step, setStep] = useState<Step>('outcome');
  const [obstacle, setObstacle] = useState('');
  const [todayThen, setTodayThen] = useState('');
  const [revised, setRevised] = useState('');
  if (!goal) return null;
  const crit = goal.successCriteria[0];
  const plan = goal.charter.obstaclePlan.trim();
  const finish = (still: boolean | undefined) =>
    void write({
      kind: 'woop',
      ...(obstacle.trim() ? { obstacleToday: obstacle.trim() } : {}),
      ...(obstacle.trim() && todayThen.trim()
        ? { todayPlan: `When ${obstacle.trim()}, I will ${todayThen.trim()}` }
        : {}),
      ...(still !== undefined ? { planStillRight: still } : {}),
      ...(revised.trim()
        ? { revisedPlan: revised.trim(), revisedPlanStatus: 'pending' as const }
        : {}),
    });
  const skip = () => void write({ kind: 'woop', skipped: true });
  const steps: Step[] = ['outcome', 'obstacle', 'plan'];
  const at = step === 'revise' ? 2 : steps.indexOf(step);

  return (
    <section className="card woop" aria-labelledby="woop-title">
      <div className="woop-head">
        <p className="eyebrow" id="woop-title">
          Before you start · about 30 seconds
        </p>
        <div className="woop-dots" aria-label={`Step ${at + 1} of 3`}>
          {steps.map((s, i) => (
            <span key={s} className={i <= at ? 'on' : ''} />
          ))}
        </div>
      </div>

      {step === 'outcome' && (
        <>
          <h2 className="woop-q">Picture the day it’s done.</h2>
          <p className="muted">
            Take a few breaths. Where are you? What’s different? What’s the best part?
          </p>
          <div className="woop-outcome">
            <span className="breath" aria-hidden="true" />
            <div>
              {crit?.description && <p className="woop-proof">{crit.description}</p>}
              {goal.charter.why && (
                <p className="muted small">Why it matters to you: {goal.charter.why}</p>
              )}
            </div>
          </div>
          <div className="row-actions">
            <button type="button" className="btn primary" onClick={() => setStep('obstacle')}>
              I’ve pictured it
            </button>
            <span className="spacer" />
            <button type="button" className="link-btn" onClick={skip}>
              Skip for today
            </button>
          </div>
        </>
      )}

      {step === 'obstacle' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStep('plan');
          }}
        >
          <h2 className="woop-q">
            <label htmlFor="woop-obstacle">What’s most likely to get in the way today?</label>
          </h2>
          {goal.charter.obstacle && (
            <p className="muted small">Last time you named: “{goal.charter.obstacle}”</p>
          )}
          <input
            id="woop-obstacle"
            value={obstacle}
            onChange={(e) => setObstacle(e.target.value)}
            autoFocus
          />
          <div className="row-actions">
            <button type="submit" className="btn primary">
              {obstacle.trim() ? 'Continue' : 'Nothing new today'}
            </button>
            <span className="spacer" />
            <button type="button" className="link-btn" onClick={skip}>
              Skip for today
            </button>
          </div>
        </form>
      )}

      {step === 'plan' && (
        <>
          {plan ? (
            <>
              <p className="muted small">Your plan for when it shows up</p>
              <p className="woop-plan">
                <IfThenLine text={plan} />
              </p>
            </>
          ) : (
            <p className="muted">
              You haven’t written an if-then plan yet; you can add one in the charter.
            </p>
          )}
          {obstacle.trim() && (
            <div className="field">
              <label htmlFor="woop-today">
                And today, when <em>{obstacle.trim()}</em>, what will you do?
              </label>
              <div className="prefixed">
                <span>I will</span>
                <input
                  id="woop-today"
                  value={todayThen}
                  onChange={(e) => setTodayThen(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          )}
          <div className="row-actions">
            {plan ? (
              <>
                <button type="button" className="btn primary" onClick={() => finish(true)}>
                  Still right
                </button>
                <button type="button" className="btn" onClick={() => setStep('revise')}>
                  Not quite
                </button>
              </>
            ) : (
              <button type="button" className="btn primary" onClick={() => finish(undefined)}>
                Done
              </button>
            )}
          </div>
        </>
      )}

      {step === 'revise' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            finish(false);
          }}
        >
          <h2 className="woop-q">
            <label htmlFor="woop-revise">How would you put it now?</label>
          </h2>
          <p className="muted small">
            It’s saved as a draft; you can apply it to your charter in your next Plan session.
          </p>
          <input
            id="woop-revise"
            value={revised}
            onChange={(e) => setRevised(e.target.value)}
            placeholder="When ___, I will ___"
            autoFocus
          />
          <div className="row-actions">
            <button type="submit" className="btn primary">
              Save
            </button>
            <button type="button" className="btn ghost" onClick={() => setStep('plan')}>
              Back
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** "Today: When X, I will Y." under the charter line, for the day it was written. */
export function TodaysPlan({ plan }: { plan: string }) {
  return (
    <p className="today-plan">
      <span className="eyebrow">Today</span> <IfThenLine text={plan} />
    </p>
  );
}

const MOMENT_LEAD: Record<NonNullable<CheckIn['trigger']>, string> = {
  stoppedEarly: 'You stopped well before your prediction.',
  resume: 'If coming back feels heavy:',
  stuck: 'This one keeps slipping.',
};

/**
 * Show the user's own if-then at the moment it was written for, and ask whether this is that
 * moment. If it is, ask for their smallest version of what's next.
 */
export function ObstacleMoment(props: {
  trigger: NonNullable<CheckIn['trigger']>;
  taskId?: ID;
  /** Label for the button that starts the small version. */
  startLabel?: string;
  onStartTiny: (focus: string) => void;
}) {
  const { goal } = useStore();
  const write = useCheckInWriter();
  const [state, setState] = useState<'ask' | 'tiny' | 'declined'>('ask');
  const [id, setId] = useState<ID | null>(null);
  const [tiny, setTiny] = useState('');
  if (!goal?.charter.obstaclePlan.trim() || state === 'declined') return null;
  const base = {
    kind: 'obstacleMoment' as const,
    trigger: props.trigger,
    ...(props.taskId ? { taskId: props.taskId } : {}),
  };
  return (
    <div className="moment" role="group" aria-label="Your if-then plan">
      <p className="muted small">{MOMENT_LEAD[props.trigger]} Your plan:</p>
      <p className="woop-plan">
        <IfThenLine text={goal.charter.obstaclePlan} />
      </p>
      {state === 'ask' ? (
        <div className="row-actions">
          <span className="prompt inline">Is this that moment?</span>
          <button
            type="button"
            className="btn small primary"
            onClick={async () => {
              const c = await write({ ...base, isThatMoment: true });
              if (c) setId(c.id);
              setState('tiny');
            }}
          >
            Yes
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              void write({ ...base, isThatMoment: false });
              setState('declined');
            }}
          >
            Not this time
          </button>
        </div>
      ) : (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!tiny.trim()) return;
            await write({ ...base, isThatMoment: true, tinyVersion: tiny.trim() }, id ?? undefined);
            props.onStartTiny(tiny.trim());
          }}
        >
          <label htmlFor={`tiny-${props.trigger}-${props.taskId ?? ''}`}>
            What’s a 10-minute version of what’s next?
          </label>
          <input
            id={`tiny-${props.trigger}-${props.taskId ?? ''}`}
            value={tiny}
            onChange={(e) => setTiny(e.target.value)}
            autoFocus
          />
          <div className="row-actions">
            <button type="submit" className="btn primary small" disabled={!tiny.trim()}>
              {props.startLabel ?? 'Start 10 minutes'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** After completing a task: what it unlocked, how close the milestone is, and a reflection. */
export function ProgressCard(props: {
  progress: CompletionProgress;
  minutes: number;
  estimateBase?: number;
  onClose: () => void;
}) {
  const { progress: p } = props;
  const { commit, goal, session, ids, clock } = useStore();
  const [lesson, setLesson] = useState('');
  const [saved, setSaved] = useState(false);
  const m = p.milestone;
  return (
    <section className="card progress-card" aria-labelledby="progress-title" aria-live="polite">
      <p className="eyebrow">Done</p>
      <h1 id="progress-title" className="next-title">
        {p.task.title}
      </h1>
      {props.estimateBase ? (
        <p className="muted small">
          {fmtMinutes(props.minutes)} in total · your likely estimate was{' '}
          {fmtMinutes(props.estimateBase)}
        </p>
      ) : null}

      {p.unlocked.length > 0 && (
        <div className="unlocked">
          <p className="eyebrow">Now unlocked</p>
          <ul>
            {p.unlocked.map((u) => (
              <li key={u.id}>
                {u.title}
                {u.kind === 'wait' ? (
                  <span className="muted small"> · the wait can begin</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {m && (
        <div className={`ms-progress${m.reached ? ' reached' : ''}`}>
          <p className="ms-progress-title">
            {m.reached ? 'Milestone reached: ' : ''}
            <strong>{m.title}</strong>
          </p>
          <div
            className="progress big"
            role="progressbar"
            aria-valuenow={m.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${m.title} progress`}
          >
            <span style={{ width: `${m.pct}%` }} />
          </div>
          <p className="muted small">
            {m.doneTasks} of {m.totalTasks} done
            {!m.reached && m.remaining.length > 0
              ? ` · ${m.remaining.length} left: ${m.remaining
                  .slice(0, 3)
                  .map((r) => r.title)
                  .join(', ')}${m.remaining.length > 3 ? '…' : ''}`
              : ''}
          </p>
          {m.reached && (
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!lesson.trim() || !goal) return;
                const r = await commit((w) => ({
                  ...w,
                  memory: [
                    ...w.memory,
                    {
                      id: ids.next(),
                      goalId: goal.id,
                      kind: 'lesson',
                      text: `${m.title}: ${lesson.trim()}`,
                      createdAt: clock.now(),
                      sessionId: session?.id ?? '',
                    },
                  ],
                }));
                if (r.ok) setSaved(true);
              }}
            >
              <label htmlFor="ms-lesson">What did reaching this prove to you?</label>
              {saved ? (
                <p className="saved">Saved to your memory log.</p>
              ) : (
                <>
                  <input
                    id="ms-lesson"
                    value={lesson}
                    onChange={(e) => setLesson(e.target.value)}
                  />
                  <div className="row-actions">
                    <button type="submit" className="btn small" disabled={!lesson.trim()}>
                      Save
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
        </div>
      )}

      <p className="muted small">
        {p.goal.doneTasks} of {p.goal.totalTasks} planned tasks done toward “{goal?.title}”.
      </p>
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={props.onClose} autoFocus>
          Continue
        </button>
        <Link to="/done" className="link-btn">
          See everything you’ve done →
        </Link>
      </div>
    </section>
  );
}

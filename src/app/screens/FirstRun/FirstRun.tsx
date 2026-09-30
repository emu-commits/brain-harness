import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, withSettings } from '../../store';
import { applyAnswer } from '../../../core/questions/apply';
import { CHARTER_SEQUENCE, promptFor, question } from '../../../core/questions/bank';
import { EXAMPLES } from '../../../core/questions/examples';
import type { Answer } from '../../../core/questions/types';
import { endSession, startSession } from '../../../core/harness/sessions';
import type { Workspace } from '../../../core/model/types';
import { upsert } from '../../../core/model/factories';
import { addDays } from '../../../core/util/dates';
import { Errors } from '../../components/Sheet';
import { Logo } from '../../App';

type Step = (typeof CHARTER_SEQUENCE)[number];

interface Draft {
  title: string;
  proof: string;
  metric: string;
  target: string;
  unit: string;
  date: string;
  why: string;
  obstacle: string;
  when: string;
  then: string;
  milestone: string;
  task: string;
  taskWhen: string;
  taskWhere: string;
  taskDone: string;
}

const EMPTY: Draft = {
  title: '',
  proof: '',
  metric: '',
  target: '',
  unit: '',
  date: '',
  why: '',
  obstacle: '',
  when: '',
  then: '',
  milestone: '',
  task: '',
  taskWhen: '',
  taskWhere: '',
  taskDone: '',
};

function answerFor(step: Step, d: Draft): Answer {
  switch (step) {
    case 'C1':
      return { type: 'text', value: d.title };
    case 'C2': {
      const hasNumber = d.target.trim() !== '' && Number.isFinite(Number(d.target));
      return {
        type: 'criterion',
        description: d.proof,
        metric: hasNumber ? d.metric || d.unit || 'value' : '',
        target: hasNumber ? Number(d.target) : undefined,
        unit: d.unit,
      };
    }
    case 'C3':
      return { type: 'date', value: d.date };
    case 'C4':
      return { type: 'text', value: d.why };
    case 'C5':
      return { type: 'text', value: d.obstacle };
    case 'C6':
      return { type: 'ifThen', when: d.when, then: d.then };
    case 'C7':
      return { type: 'text', value: d.milestone };
    case 'C8':
      return {
        type: 'firstTask',
        title: d.task,
        when: d.taskWhen,
        where: d.taskWhere,
        definitionOfDone: d.taskDone,
      };
  }
}

function missing(step: Step, d: Draft): string | null {
  switch (step) {
    case 'C1':
      return d.title.trim() ? null : 'Write what you’re trying to make happen.';
    case 'C2':
      if (!d.proof.trim()) return 'Describe what you could point to.';
      if (d.target.trim() && !Number.isFinite(Number(d.target)))
        return 'The target should be a number.';
      return null;
    case 'C3':
      return d.date ? null : 'Pick a date.';
    case 'C4':
      return d.why.trim() ? null : 'A few words is enough.';
    case 'C5':
      return d.obstacle.trim() ? null : 'Name one thing.';
    case 'C6':
      return d.when.trim() && d.then.trim() ? null : 'Fill in both parts.';
    case 'C7':
      return d.milestone.trim() ? null : 'Describe what has to be true.';
    case 'C8':
      if (!d.task.trim()) return 'Name one action.';
      return d.taskDone.trim() ? null : 'How will you know it’s done?';
  }
}

export function FirstRun() {
  const { ws, commit, ids, clock } = useStore();
  const navigate = useNavigate();
  const [i, setI] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [stuck, setStuck] = useState<Record<string, number>>({});
  const [showExample, setShowExample] = useState(false);
  const step = CHARTER_SEQUENCE[i]!;
  const q = question(step);
  const { prompt, helper } = promptFor(q, 1);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setD({ ...d, [k]: e.target.value });
  const example = q.example ? EXAMPLES[q.example] : undefined;
  const isNewGoal = ws.goals.length > 0;

  const finish = async () => {
    const r = await commit(
      (w0: Workspace) => {
        // Stand up the goal inside its first Plan session, apply C1–C8, then end the session.
        let w = w0;
        let goalId: string | undefined;
        let sessionId = '';
        for (const s of CHARTER_SEQUENCE) {
          const a = applyAnswer(w, question(s), answerFor(s, d), { goalId, ids, clock });
          if (!a.ok) return a;
          w = a.value.ws;
          goalId = a.value.goalId;
          if (s === 'C1') {
            const st = startSession(w, goalId, 'plan', ids, clock);
            w = st.ws;
            sessionId = st.session.id;
          }
        }
        w = endSession(w, sessionId, clock);
        for (const [qid, n] of Object.entries(stuck)) {
          const prev = w.questionStats.find((x) => x.id === qid) ?? {
            id: qid,
            stuckTaps: 0,
            attempts: 0,
          };
          w = {
            ...w,
            questionStats: upsert(w.questionStats, {
              ...prev,
              stuckTaps: prev.stuckTaps + n,
              attempts: prev.attempts + 1,
            }),
          };
        }
        return withSettings(w, { activeGoalId: goalId });
        // The whole flow runs inside the goal's first Plan session, opened and closed in this commit.
      },
      { bypassModeGuard: true },
    );
    if (!r.ok) return setErrors(r.errors);
    navigate('/today', { replace: true, state: { firstRun: true } });
  };

  const next = () => {
    const m = missing(step, d);
    if (m) return setErrors([m]);
    setErrors([]);
    setShowExample(false);
    if (i < CHARTER_SEQUENCE.length - 1) setI(i + 1);
    else void finish();
  };

  return (
    <div className="firstrun">
      <header className="fr-head">
        <span className="fr-brand">
          <Logo /> GoalGraph
        </span>
        {isNewGoal && (
          <Link to="/today" className="link-btn">
            Cancel
          </Link>
        )}
      </header>
      <form
        className="fr-card"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <div className="fr-progress" aria-label={`Question ${i + 1} of ${CHARTER_SEQUENCE.length}`}>
          {CHARTER_SEQUENCE.map((s, j) => (
            <span key={s} className={j < i ? 'done' : j === i ? 'now' : ''} />
          ))}
        </div>
        {i > 0 && d.title && <p className="fr-context">{d.title}</p>}
        <h1 className={i === 0 ? 'fr-q fr-q-lg' : 'fr-q'}>
          <label htmlFor={`q-${step}`}>{prompt}</label>
        </h1>
        {helper && <p className="fr-helper">{helper}</p>}

        {step === 'C1' && (
          <textarea
            id="q-C1"
            className="fr-big"
            rows={2}
            value={d.title}
            onChange={set('title')}
            placeholder="I want to…"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), next())}
          />
        )}
        {step === 'C2' && (
          <>
            <textarea id="q-C2" rows={3} value={d.proof} onChange={set('proof')} autoFocus />
            <fieldset className="fr-number">
              <legend>Is there a number? (optional)</legend>
              <div className="row3">
                <label>
                  <span>What you count</span>
                  <input value={d.metric} onChange={set('metric')} />
                </label>
                <label>
                  <span>Target</span>
                  <input inputMode="decimal" value={d.target} onChange={set('target')} />
                </label>
                <label>
                  <span>Unit</span>
                  <input value={d.unit} onChange={set('unit')} />
                </label>
              </div>
            </fieldset>
          </>
        )}
        {step === 'C3' && (
          <input
            id="q-C3"
            type="date"
            value={d.date}
            min={addDays(clock.today(), 1)}
            onChange={set('date')}
            autoFocus
          />
        )}
        {step === 'C4' && (
          <textarea id="q-C4" rows={3} value={d.why} onChange={set('why')} autoFocus />
        )}
        {step === 'C5' && (
          <input id="q-C5" value={d.obstacle} onChange={set('obstacle')} autoFocus />
        )}
        {step === 'C6' && (
          <div className="ifthen">
            {d.obstacle && <p className="fr-context">You said: “{d.obstacle}”</p>}
            <label>
              <span>When</span>
              <input id="q-C6" value={d.when} onChange={set('when')} autoFocus />
            </label>
            <label>
              <span>I will</span>
              <input value={d.then} onChange={set('then')} />
            </label>
          </div>
        )}
        {step === 'C7' && (
          <input id="q-C7" value={d.milestone} onChange={set('milestone')} autoFocus />
        )}
        {step === 'C8' && (
          <div className="stack">
            {d.milestone && <p className="fr-context">Toward: “{d.milestone}”</p>}
            <input
              id="q-C8"
              value={d.task}
              onChange={set('task')}
              autoFocus
              aria-describedby="c8-help"
            />
            <div className="row2">
              <label>
                <span>When will you do it?</span>
                <input value={d.taskWhen} onChange={set('taskWhen')} />
              </label>
              <label>
                <span>Where?</span>
                <input value={d.taskWhere} onChange={set('taskWhere')} />
              </label>
            </div>
            <label>
              <span>How will you know it’s done?</span>
              <input value={d.taskDone} onChange={set('taskDone')} />
            </label>
          </div>
        )}

        <Errors errors={errors} />
        {showExample && example && (
          <aside className="example">
            <p className="eyebrow">The shape a strong answer often takes</p>
            <p>{example.lesson}</p>
            <ul>
              {example.samples.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </aside>
        )}
        <div className="fr-actions">
          {i > 0 && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => (setErrors([]), setShowExample(false), setI(i - 1))}
            >
              Back
            </button>
          )}
          {example && !showExample && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setShowExample(true);
                setStuck({ ...stuck, [step]: (stuck[step] ?? 0) + 1 });
              }}
            >
              I’m stuck
            </button>
          )}
          <span className="spacer" />
          <button type="submit" className="btn primary">
            {i === CHARTER_SEQUENCE.length - 1 ? 'Finish' : 'Continue'}
          </button>
        </div>
      </form>
      {i === 0 && !isNewGoal && (
        <p className="fr-foot">
          No account. Everything stays in this browser.{' '}
          <Link to="/settings">Try the demo instead</Link>
        </p>
      )}
    </div>
  );
}

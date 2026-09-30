import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store';
import { detectGaps, gapPrompt, gapQuestion } from '../../../core/questions/gaps';
import type { Gap } from '../../../core/questions/gaps';
import { applyAnswer } from '../../../core/questions/apply';
import { bindQuestion, promptFor, question } from '../../../core/questions/bank';
import { EXAMPLES } from '../../../core/questions/examples';
import type { Answer } from '../../../core/questions/types';
import type { GapStats, ID, Workspace } from '../../../core/model/types';
import { getSettings, upsert } from '../../../core/model/factories';
import { calibrationSamples, suggestMultiplier } from '../../../core/engines/calibration';
import { AnswerInput } from './AnswerInput';
import { Errors } from '../../components/Sheet';

function bumpStats(ws: Workspace, sessionId: ID, d: Partial<GapStats>): Workspace {
  return {
    ...ws,
    sessions: ws.sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const g = s.gapStats ?? { shown: 0, resolved: 0, stuckTaps: 0 };
      return {
        ...s,
        gapStats: {
          shown: g.shown + (d.shown ?? 0),
          resolved: g.resolved + (d.resolved ?? 0),
          stuckTaps: g.stuckTaps + (d.stuckTaps ?? 0),
        },
      };
    }),
  };
}

function bumpQuestion(
  ws: Workspace,
  qid: string,
  d: { stuckTaps?: number; attempts?: number },
): Workspace {
  const prev = ws.questionStats.find((q) => q.id === qid) ?? { id: qid, stuckTaps: 0, attempts: 0 };
  return {
    ...ws,
    questionStats: upsert(ws.questionStats, {
      ...prev,
      stuckTaps: prev.stuckTaps + (d.stuckTaps ?? 0),
      attempts: prev.attempts + (d.attempts ?? 0),
    }),
  };
}

export function GapsPanel({ editable }: { editable: boolean }) {
  const { session } = useStore();
  return <GapsInner key={session?.id ?? 'none'} editable={editable} />;
}

function GapsInner({ editable }: { editable: boolean }) {
  const { ws, goal, session, commit, ids, clock } = useStore();
  const today = clock.today();
  const settings = getSettings(ws);
  const gaps = useMemo(() => (goal ? detectGaps(ws, goal.id, today) : []), [ws, goal, today]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [shownKeys, setShownKeys] = useState<string[]>([]);
  const counted = useRef(new Set<string>());
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [after, setAfter] = useState<null | { gap: Gap; created: ID[] }>(null);

  const visible = gaps.filter((g) => !skipped.includes(g.key));
  const current = after ? after.gap : visible[0];
  const shown = session?.gapStats?.shown ?? 0;
  const capReached =
    !after && !!current && shown >= settings.maxGapsPerSession && !shownKeys.includes(current.key);

  useEffect(() => {
    if (
      !editable ||
      !session ||
      !current ||
      after ||
      capReached ||
      counted.current.has(current.key)
    )
      return;
    counted.current.add(current.key);
    setShownKeys((k) => [...k, current.key]);
    void commit((w) => bumpStats(w, session.id, { shown: 1 }));
  }, [editable, session, current, after, capReached, commit]);

  if (!goal) return null;
  const level = goal.scaffoldLevel;

  if (!editable) {
    return (
      <section className="panel">
        <h2 className="section-title">Open questions</h2>
        {gaps.length ? (
          <>
            <p className="muted">
              The harness sees {gaps.length} gap{gaps.length === 1 ? '' : 's'} in the model. A Plan
              session asks up to {settings.maxGapsPerSession}, one at a time.
            </p>
            <ol className="gap-preview">
              {gaps.slice(0, settings.maxGapsPerSession).map((g) => (
                <li key={g.key}>{gapPrompt(g, level).prompt}</li>
              ))}
            </ol>
          </>
        ) : (
          <p className="muted">No gaps the harness can see.</p>
        )}
      </section>
    );
  }

  const next = () => {
    setAfter(null);
    setAnswer(null);
    setRevealed(false);
    setErrors([]);
    setInputKey((k) => k + 1);
  };

  if (!current) {
    return (
      <section className="panel done-panel">
        <h2 className="section-title">No open questions</h2>
        <p className="muted">
          The harness doesn’t see any gaps right now. Anything else is yours to add, in the list or
          the graph.
        </p>
        <div className="row-actions">
          <Link className="btn" to="/plan/list">
            Open the list
          </Link>
          <Link className="btn ghost" to="/plan/charter">
            Charter &amp; premortem
          </Link>
        </div>
      </section>
    );
  }
  if (capReached) {
    return (
      <section className="panel done-panel">
        <h2 className="section-title">That’s enough questions for one session</h2>
        <p className="muted">
          {visible.length} more will be waiting next time. Asking a little, often, works better than
          a long questionnaire.
        </p>
      </section>
    );
  }

  const q = gapQuestion(current);
  const { prompt, helper } = gapPrompt(current, level);
  const example = q.example ? EXAMPLES[q.example] : undefined;

  const submit = async () => {
    if (!answer) return setErrors(['Answer first — or skip it for now.']);
    const r = await commit((w) => {
      const res = applyAnswer(w, q, answer, { goalId: goal.id, ids, clock });
      if (!res.ok) return res;
      return bumpQuestion(bumpStats(res.value.ws, session!.id, { resolved: 1 }), q.id, {
        attempts: 1,
      });
    });
    if (!r.ok) return setErrors(r.errors);
    const created = r.ws.tasks.filter((t) => !ws.tasks.some((x) => x.id === t.id)).map((t) => t.id);
    setErrors([]);
    setAfter({ gap: current, created });
  };

  return (
    <section className="panel gap-panel" aria-labelledby="gap-q">
      <p className="eyebrow">
        Question {Math.max(shown, 1)} · up to {settings.maxGapsPerSession} this session
      </p>
      <h2 id="gap-q" className="gap-prompt">
        <label htmlFor={`gap-input-${inputKey}`}>{prompt}</label>
      </h2>
      {helper && <p className="fr-helper">{helper}</p>}

      {!after ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <AnswerInput
            key={inputKey}
            type={q.answerType}
            ws={ws}
            goalId={goal.id}
            objectId={current.objectId}
            inputId={`gap-input-${inputKey}`}
            onChange={setAnswer}
          />
          <Errors errors={errors} />
          {revealed && <ExampleBox id={q.example} />}
          <div className="row-actions">
            <button type="submit" className="btn primary">
              Save answer
            </button>
            {!revealed && (
              <button
                type="button"
                className="btn ghost"
                onClick={async () => {
                  setRevealed(true);
                  await commit((w) =>
                    bumpQuestion(bumpStats(w, session!.id, { stuckTaps: 1 }), q.id, {
                      stuckTaps: 1,
                    }),
                  );
                }}
              >
                I’m stuck
              </button>
            )}
            <span className="spacer" />
            <button
              type="button"
              className="link-btn"
              onClick={() => (setSkipped([...skipped, current.key]), next())}
            >
              Skip for now
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={async () => {
                await commit((w) =>
                  bumpStats(
                    {
                      ...w,
                      gapDismissals: [
                        ...w.gapDismissals,
                        {
                          id: ids.next(),
                          gapKey: current.key,
                          objectHash: current.objectHash,
                          at: clock.now(),
                        },
                      ],
                    },
                    session!.id,
                    { resolved: 1 },
                  ),
                );
                next();
              }}
            >
              Doesn’t apply
            </button>
          </div>
        </form>
      ) : (
        <AfterAnswer gap={after.gap} example={example ? q.example : undefined} onNext={next} />
      )}
    </section>
  );
}

function ExampleBox({ id }: { id?: string }) {
  const ex = id ? EXAMPLES[id] : undefined;
  if (!ex)
    return <p className="example">Try a rough answer. You can refine it any time in the list.</p>;
  return (
    <aside className="example">
      <p className="eyebrow">The shape a strong answer often takes</p>
      <p>{ex.lesson}</p>
      <ul>
        {ex.samples.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </aside>
  );
}

/** After an attempt: compare with an example; for estimates, the calibration mirror and E2. */
function AfterAnswer({ gap, example, onNext }: { gap: Gap; example?: string; onNext: () => void }) {
  const { ws, goal, commit, ids, clock } = useStore();
  const [ref, setRef] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const isEstimate = gap.code === 'G6';
  const task = ws.tasks.find((t) => t.id === gap.objectId);
  const settings = getSettings(ws);
  const cal =
    isEstimate && goal
      ? suggestMultiplier(
          calibrationSamples(ws, goal.id),
          task?.category,
          settings.calibration.window,
          settings.calibration.minTasks,
        )
      : null;
  const e2 = promptFor(question('E2'), goal?.scaffoldLevel ?? 1);
  return (
    <div className="after">
      <p className="saved">Saved.</p>
      {cal && task?.estimateMinutes && (
        <p className="mirror">
          Your {cal.category === '*' ? '' : `${cal.category} `}tasks have run about{' '}
          <strong>{cal.multiplier.toFixed(1)}×</strong> your likely estimate ({cal.n} recent).
        </p>
      )}
      {example && (
        <details>
          <summary>Compare with an example</summary>
          <ExampleBox id={example} />
        </details>
      )}
      {isEstimate && task && (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = Number(ref);
            if (!ref.trim()) return onNext();
            const r = await commit((w) => {
              const res = applyAnswer(
                w,
                bindQuestion(question('E2'), task.id),
                { type: 'number', value: n },
                { goalId: goal!.id, ids, clock },
              );
              return res.ok ? res.value.ws : res;
            });
            if (!r.ok) return setErrors(r.errors);
            onNext();
          }}
        >
          <label htmlFor="e2">{e2.prompt}</label>
          {e2.helper && <p className="hint">{e2.helper}</p>}
          <input
            id="e2"
            inputMode="numeric"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="minutes"
          />
          <Errors errors={errors} />
          <div className="row-actions">
            <button type="submit" className="btn primary">
              Next question
            </button>
          </div>
        </form>
      )}
      {!isEstimate && (
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={onNext} autoFocus>
            Next question
          </button>
        </div>
      )}
    </div>
  );
}

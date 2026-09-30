import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useSessionApi } from '../../session';
import { useToast } from '../../toast';
import { postTaskHook, preTaskHook } from '../../../core/harness/hooks';
import { activeSession } from '../../../core/harness/sessions';
import type { Task } from '../../../core/model/types';
import { beginTask, cancelRunning, recordSitting } from '../../actions';
import type { SittingInput } from '../../actions';
import { Errors, Sheet } from '../../components/Sheet';
import { Field, MoneyInput } from '../../components/inputs';
import { fmtMinutes } from '../../format';
import { loggedMinutesByTask } from '../../../core/model/factories';

// The Execute loop: preTask hook → optional timer → postTask hook.

export function PreTaskSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const { commit, clock } = useStore();
  const api = useSessionApi();
  const hook = preTaskHook(task);
  const [dod, setDod] = useState(hook.definitionOfDone);
  const [predicted, setPredicted] = useState(
    hook.predictedMinutesDefault ? String(hook.predictedMinutesDefault) : '',
  );
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const begin = async () => {
    if (!dod.trim()) return setErrors(['Write what “done” looks like before you start.']);
    if (!(await api.ensure('execute'))) return;
    const p = Number(predicted);
    const r = await commit((w) => {
      const s = activeSession(w);
      if (!s) return w;
      return beginTask(
        w,
        task.id,
        {
          sessionId: s.id,
          definitionOfDone: dod,
          intention:
            hook.askIntention && (when.trim() || where.trim())
              ? { when: when.trim(), where: where.trim() }
              : undefined,
          predictedMinutes: Number.isFinite(p) && p > 0 ? p : undefined,
        },
        clock,
      );
    });
    if (!r.ok) return setErrors(r.errors);
    onClose();
  };
  return (
    <Sheet
      title={task.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Not now
          </button>
          <button type="button" className="btn primary" onClick={() => void begin()}>
            Begin
          </button>
        </>
      }
    >
      <Field
        label="Done when"
        hint={task.definitionOfDone ? 'Confirm it, or sharpen it.' : 'Something observable.'}
      >
        {(id) => <textarea id={id} rows={2} value={dod} onChange={(e) => setDod(e.target.value)} />}
      </Field>
      <Field label="How long do you think this sitting will take? (minutes, optional)">
        {(id) => (
          <input
            id={id}
            inputMode="numeric"
            value={predicted}
            onChange={(e) => setPredicted(e.target.value)}
          />
        )}
      </Field>
      {hook.askIntention && (
        <fieldset className="plain-fieldset">
          <legend>When and where will you do this?</legend>
          <div className="row2">
            <label>
              <span>When</span>
              <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="Now" />
            </label>
            <label>
              <span>Where</span>
              <input value={where} onChange={(e) => setWhere(e.target.value)} />
            </label>
          </div>
        </fieldset>
      )}
      <Errors errors={errors} />
    </Sheet>
  );
}

function useElapsed(startedAt: string) {
  const { clock } = useStore();
  const [now, setNow] = useState(() => Date.parse(clock.now()));
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.parse(clock.now())), 1000);
    return () => window.clearInterval(t);
  }, [clock]);
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
}

export function RunningCard({
  task,
  startedAt,
  predicted,
  onStop,
}: {
  task: Task;
  startedAt: string;
  predicted?: number;
  onStop: (complete: boolean) => void;
}) {
  const { commit } = useStore();
  const secs = useElapsed(startedAt);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const over = predicted ? secs / 60 > predicted : false;
  return (
    <section className="card running" aria-labelledby="run-title">
      <p className="eyebrow">In progress</p>
      <h1 id="run-title" className="next-title">
        {task.title}
      </h1>
      <p className="timer" role="timer" aria-label="Elapsed time">
        {h > 0 && `${h}:`}
        {pad(m)}:{pad(s)}
      </p>
      {predicted && (
        <p className={`muted small ${over ? 'warn' : ''}`}>
          You predicted {fmtMinutes(predicted)} for this sitting.
        </p>
      )}
      <dl className="ctx">
        <div>
          <dt>Done when</dt>
          <dd>{task.definitionOfDone}</dd>
        </div>
      </dl>
      <div className="next-actions">
        <button type="button" className="btn primary big" onClick={() => onStop(true)}>
          Complete
        </button>
        <button type="button" className="btn" onClick={() => onStop(false)}>
          Stop for now
        </button>
        <button type="button" className="link-btn" onClick={() => void commit(cancelRunning)}>
          Discard timer
        </button>
      </div>
    </section>
  );
}

type EvidenceKind = 'note' | 'url' | 'metric' | 'image';

export function PostTaskSheet(props: {
  task: Task;
  startedAt: string;
  complete: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { task } = props;
  const { ws, commit, ids, clock, storage } = useStore();
  const toast = useToast();
  const hook = postTaskHook(task, props.startedAt, clock.now());
  const [minutes, setMinutes] = useState(String(hook.prefillMinutes ?? ''));
  const [cost, setCost] = useState<number | null>(null);
  const [showCost, setShowCost] = useState(hook.askCost);
  const [kind, setKind] = useState<EvidenceKind>('note');
  const [evText, setEvText] = useState('');
  const [metricName, setMetricName] = useState('');
  const [metricValue, setMetricValue] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [surprise, setSurprise] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const save = async () => {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins < 0)
      return setErrors(['Enter the minutes you actually spent.']);
    const evidence: SittingInput['evidence'] = [];
    if (kind === 'note' && evText.trim()) evidence.push({ kind: 'note', text: evText.trim() });
    if (kind === 'url' && evText.trim()) evidence.push({ kind: 'url', url: evText.trim() });
    if (kind === 'metric' && metricName.trim() && metricValue.trim()) {
      const v = Number(metricValue);
      if (!Number.isFinite(v)) return setErrors(['The metric value should be a number.']);
      evidence.push({ kind: 'metric', metricName: metricName.trim(), value: v });
    }
    if (kind === 'image' && file) {
      const id = ids.next();
      await storage.putImage({ id, type: file.type, blob: file });
      evidence.push({ kind: 'image', imageBlobId: id, text: evText.trim() || undefined });
    }
    const prevLogged = loggedMinutesByTask(ws)[task.id] ?? 0;
    const r = await commit((w) =>
      recordSitting(
        w,
        {
          minutes: Math.round(mins),
          cost: showCost && cost !== null ? cost : undefined,
          complete: props.complete,
          surprise,
          evidence,
        },
        ids,
        clock,
      ),
    );
    if (!r.ok) return setErrors(r.errors);
    if (props.complete && task.estimateMinutes) {
      const total = prevLogged + Math.round(mins);
      toast(
        `Logged ${fmtMinutes(total)} in total · your likely estimate was ${fmtMinutes(task.estimateMinutes.base)}.`,
      );
    }
    props.onDone();
  };

  return (
    <Sheet
      title={props.complete ? 'Done. What happened?' : 'Pausing. What happened?'}
      onClose={props.onClose}
      footer={
        <button type="button" className="btn primary" onClick={() => void save()}>
          Save
        </button>
      }
    >
      <Field label="Minutes spent">
        {(id) => (
          <input
            id={id}
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        )}
      </Field>
      {showCost ? (
        <Field
          label={`Actual cost (${ws.goals.find((g) => g.id === task.goalId)?.currency ?? 'USD'})`}
        >
          {(id) => <MoneyInput id={id} onChange={setCost} />}
        </Field>
      ) : (
        <button type="button" className="link-btn" onClick={() => setShowCost(true)}>
          + Add a cost
        </button>
      )}
      <fieldset className="plain-fieldset">
        <legend>Evidence (optional)</legend>
        <div className="seg" role="radiogroup" aria-label="Evidence type">
          {(['note', 'url', 'metric', 'image'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'on' : ''}
              onClick={() => setKind(k)}
            >
              {k === 'note' ? 'Note' : k === 'url' ? 'Link' : k === 'metric' ? 'Number' : 'Photo'}
            </button>
          ))}
        </div>
        {kind === 'note' && (
          <textarea
            aria-label="Evidence note"
            rows={2}
            value={evText}
            onChange={(e) => setEvText(e.target.value)}
            placeholder="What exists now that didn’t before?"
          />
        )}
        {kind === 'url' && (
          <input
            aria-label="Evidence link"
            type="url"
            value={evText}
            onChange={(e) => setEvText(e.target.value)}
            placeholder="https://"
          />
        )}
        {kind === 'metric' && (
          <div className="row2">
            <input
              aria-label="What you measured"
              value={metricName}
              onChange={(e) => setMetricName(e.target.value)}
              placeholder="What you measured"
            />
            <input
              aria-label="Value"
              inputMode="decimal"
              value={metricValue}
              onChange={(e) => setMetricValue(e.target.value)}
              placeholder="Value"
            />
          </div>
        )}
        {kind === 'image' && (
          <input
            aria-label="Photo"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        )}
      </fieldset>
      <Field label="What surprised you? (optional)">
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={surprise}
            onChange={(e) => setSurprise(e.target.value)}
          />
        )}
      </Field>
      <Errors errors={errors} />
    </Sheet>
  );
}

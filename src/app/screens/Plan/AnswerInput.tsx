import { useState } from 'react';
import type { Answer, AnswerType } from '../../../core/questions/types';
import type { AccountType, ID, WeekMinutes, Workspace } from '../../../core/model/types';
import { capacityOf, milestonesOfGoal, tasksOfGoal } from '../../../core/model/factories';
import { cyclePathIfAdded } from '../../../core/engines/graph';
import {
  CapacityInput,
  MinutesRangeInput,
  MoneyInput,
  TaskListInput,
} from '../../components/inputs';

/** Renders the input for a question's answer type and reports a candidate Answer (or null). */
export function AnswerInput(props: {
  type: AnswerType;
  ws: Workspace;
  goalId: ID;
  objectId: ID;
  inputId: string;
  placeholder?: string;
  onChange: (a: Answer | null) => void;
}) {
  const { type, ws, goalId, objectId, inputId, onChange } = props;
  switch (type) {
    case 'text':
      return (
        <input
          id={inputId}
          placeholder={props.placeholder}
          onChange={(e) =>
            onChange(e.target.value.trim() ? { type: 'text', value: e.target.value } : null)
          }
        />
      );
    case 'longText':
      return (
        <textarea
          id={inputId}
          rows={3}
          onChange={(e) =>
            onChange(e.target.value.trim() ? { type: 'text', value: e.target.value } : null)
          }
        />
      );
    case 'number':
      return (
        <input
          id={inputId}
          inputMode="decimal"
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(
              e.target.value.trim() && Number.isFinite(n) ? { type: 'number', value: n } : null,
            );
          }}
        />
      );
    case 'minutesRange':
      return (
        <MinutesRangeInput onChange={(r) => onChange(r ? { type: 'range', value: r } : null)} />
      );
    case 'taskList':
    case 'premortem':
      return <ListAnswer type={type} onChange={onChange} />;
    case 'criterion':
      return <CriterionAnswer inputId={inputId} onChange={onChange} />;
    case 'capacity':
      return (
        <CapacityAnswer initial={capacityOf(ws, goalId).minutesByWeekday} onChange={onChange} />
      );
    case 'multiChoice':
      return <DependencyAnswer ws={ws} goalId={goalId} taskId={objectId} onChange={onChange} />;
    case 'account':
      return <AccountAnswer inputId={inputId} onChange={onChange} />;
    case 'revenueStart':
      return <RevenueStartAnswer ws={ws} goalId={goalId} onChange={onChange} />;
    default:
      return <p className="muted">This question type isn’t available here yet.</p>;
  }
}

function ListAnswer({
  type,
  onChange,
}: {
  type: 'taskList' | 'premortem';
  onChange: (a: Answer | null) => void;
}) {
  const [items, setItems] = useState<string[]>(['']);
  return (
    <TaskListInput
      value={items}
      label={type === 'premortem' ? 'Reason' : 'Task'}
      placeholder={type === 'premortem' ? 'It failed because…' : 'Start with a verb'}
      onChange={(v) => {
        setItems(v);
        const clean = v.map((s) => s.trim()).filter(Boolean);
        onChange(
          !clean.length
            ? null
            : type === 'premortem'
              ? { type: 'premortem', reasons: clean }
              : { type: 'taskList', titles: clean },
        );
      }}
    />
  );
}

function CriterionAnswer({
  inputId,
  onChange,
}: {
  inputId: string;
  onChange: (a: Answer | null) => void;
}) {
  const [d, setD] = useState({ description: '', metric: '', target: '', unit: '' });
  const update = (patch: Partial<typeof d>) => {
    const n = { ...d, ...patch };
    setD(n);
    const t = Number(n.target);
    if (!n.description.trim()) return onChange(null);
    onChange({
      type: 'criterion',
      description: n.description,
      metric: n.metric || n.unit,
      unit: n.unit,
      target: n.target.trim() && Number.isFinite(t) ? t : undefined,
    });
  };
  return (
    <div className="stack">
      <textarea
        id={inputId}
        rows={2}
        placeholder="What you could point to"
        onChange={(e) => update({ description: e.target.value })}
      />
      <div className="row3">
        <label>
          <span>What you count</span>
          <input onChange={(e) => update({ metric: e.target.value })} />
        </label>
        <label>
          <span>Target</span>
          <input inputMode="decimal" onChange={(e) => update({ target: e.target.value })} />
        </label>
        <label>
          <span>Unit</span>
          <input onChange={(e) => update({ unit: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

function CapacityAnswer({
  initial,
  onChange,
}: {
  initial: WeekMinutes;
  onChange: (a: Answer | null) => void;
}) {
  return (
    <CapacityInput
      value={initial}
      onChange={(w) =>
        onChange(w.some((m) => m > 0) ? { type: 'capacity', minutesByWeekday: w } : null)
      }
    />
  );
}

function DependencyAnswer({
  ws,
  goalId,
  taskId,
  onChange,
}: {
  ws: Workspace;
  goalId: ID;
  taskId: ID;
  onChange: (a: Answer | null) => void;
}) {
  const [sel, setSel] = useState<ID[]>([]);
  const tasks = tasksOfGoal(ws, goalId).filter((t) => t.id !== taskId && t.status !== 'skipped');
  const milestones = milestonesOfGoal(ws, goalId);
  const mIndex = (id?: ID) => milestones.findIndex((m) => m.id === id);
  tasks.sort(
    (a, b) =>
      (mIndex(a.milestoneId) + 1 || 1e9) - (mIndex(b.milestoneId) + 1 || 1e9) ||
      a.createdAt.localeCompare(b.createdAt),
  );
  const existing = new Set(
    ws.dependencies.filter((d) => d.toTaskId === taskId).map((d) => d.fromTaskId),
  );
  return (
    <ul className="check-list">
      {tasks.map((t) => {
        const loop = cyclePathIfAdded(
          tasks.concat(ws.tasks.filter((x) => x.id === taskId)),
          ws.dependencies,
          t.id,
          taskId,
        );
        const disabled = !!loop || existing.has(t.id);
        return (
          <li key={t.id}>
            <label className={disabled ? 'disabled' : ''}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={sel.includes(t.id) || existing.has(t.id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...sel, t.id] : sel.filter((x) => x !== t.id);
                  setSel(next);
                  onChange(next.length ? { type: 'multiChoice', values: next } : null);
                }}
              />
              <span>
                {t.title}
                {loop && <span className="muted small"> — would create a loop</span>}
                {existing.has(t.id) && (
                  <span className="muted small"> — already a predecessor</span>
                )}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function AccountAnswer({
  inputId,
  onChange,
}: {
  inputId: string;
  onChange: (a: Answer | null) => void;
}) {
  const [d, setD] = useState<{ name: string; type: AccountType; balance: number | null }>({
    name: '',
    type: 'cash',
    balance: null,
  });
  const update = (patch: Partial<typeof d>) => {
    const n = { ...d, ...patch };
    setD(n);
    onChange(
      n.name.trim() && n.balance !== null
        ? { type: 'account', name: n.name, accountType: n.type, balance: n.balance }
        : null,
    );
  };
  return (
    <div className="row3">
      <label>
        <span>Name</span>
        <input
          id={inputId}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Checking"
        />
      </label>
      <label>
        <span>Type</span>
        <select value={d.type} onChange={(e) => update({ type: e.target.value as AccountType })}>
          {['cash', 'savings', 'investment', 'retirement', 'business', 'other'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Balance</span>
        <MoneyInput onChange={(c) => update({ balance: c })} />
      </label>
    </div>
  );
}

function RevenueStartAnswer({
  ws,
  goalId,
  onChange,
}: {
  ws: Workspace;
  goalId: ID;
  onChange: (a: Answer | null) => void;
}) {
  const [mode, setMode] = useState<'milestone' | 'month'>('milestone');
  const ms = milestonesOfGoal(ws, goalId);
  return (
    <div className="stack">
      <div className="seg" role="radiogroup" aria-label="Start">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'milestone'}
          className={mode === 'milestone' ? 'on' : ''}
          onClick={() => setMode('milestone')}
        >
          After a milestone
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'month'}
          className={mode === 'month' ? 'on' : ''}
          onClick={() => setMode('month')}
        >
          In a month
        </button>
      </div>
      {mode === 'milestone' ? (
        <select
          aria-label="Milestone"
          defaultValue=""
          onChange={(e) =>
            onChange(e.target.value ? { type: 'revenueStart', milestoneId: e.target.value } : null)
          }
        >
          <option value="">Choose…</option>
          {ms.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label="Month"
          type="month"
          onChange={(e) =>
            onChange(e.target.value ? { type: 'revenueStart', startMonth: e.target.value } : null)
          }
        />
      )}
    </div>
  );
}

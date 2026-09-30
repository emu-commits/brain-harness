import { useId, useState } from 'react';
import type { Range, WeekMinutes } from '../../core/model/types';
import { centsToInput, parseMoney } from '../format';

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Field(props: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${props.className ?? ''}`}>
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
      {props.hint && <p className="hint">{props.hint}</p>}
    </div>
  );
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** Best / likely / worst. Stored as minutes; entered in minutes or hours. */
export function MinutesRangeInput(props: {
  value?: Range;
  onChange: (r: Range | null) => void;
  idPrefix?: string;
}) {
  const [unit, setUnit] = useState<'min' | 'h'>(
    props.value && props.value.high >= 120 && props.value.base % 30 === 0 ? 'h' : 'min',
  );
  const f = unit === 'h' ? 60 : 1;
  const toStr = (m: number | undefined) =>
    m === undefined ? '' : String(Math.round((m / f) * 100) / 100);
  const [vals, setVals] = useState(() => [
    toStr(props.value?.low),
    toStr(props.value?.base),
    toStr(props.value?.high),
  ]);
  const emit = (v: string[], u = unit) => {
    const k = u === 'h' ? 60 : 1;
    const [a, b, c] = v.map(num);
    if ([a, b, c].some((x) => !Number.isFinite(x!))) return props.onChange(null);
    props.onChange({ low: Math.round(a! * k), base: Math.round(b! * k), high: Math.round(c! * k) });
  };
  const bad = (() => {
    const [a, b, c] = vals.map(num);
    if ([a, b, c].some((x) => !Number.isFinite(x!))) return null;
    if (a! < 0) return 'Times can’t be negative.';
    return a! <= b! && b! <= c! ? null : 'Best ≤ likely ≤ worst.';
  })();
  return (
    <div className="range-input">
      <div className="range-row">
        {['Best', 'Likely', 'Worst'].map((label, i) => (
          <label key={label} className="range-cell">
            <span>{label}</span>
            <input
              inputMode="decimal"
              value={vals[i]}
              aria-label={`${label} case (${unit === 'h' ? 'hours' : 'minutes'})`}
              onChange={(e) => {
                const v = vals.slice();
                v[i] = e.target.value;
                setVals(v);
                emit(v);
              }}
            />
          </label>
        ))}
        <label className="range-cell unit">
          <span>Unit</span>
          <select
            value={unit}
            onChange={(e) => {
              const u = e.target.value as 'min' | 'h';
              setUnit(u);
              emit(vals, u);
            }}
          >
            <option value="min">min</option>
            <option value="h">hours</option>
          </select>
        </label>
      </div>
      {bad && <p className="field-error">{bad}</p>}
    </div>
  );
}

/** Generic low/base/high number range (days, months, percentages). */
export function NumberRangeInput(props: {
  value?: Range;
  onChange: (r: Range | null) => void;
  labels?: [string, string, string];
  unit?: string;
  scale?: number;
}) {
  const scale = props.scale ?? 1;
  const [vals, setVals] = useState(() =>
    props.value
      ? [props.value.low, props.value.base, props.value.high].map((x) =>
          String(Math.round(x * scale * 1000) / 1000),
        )
      : ['', '', ''],
  );
  const labels = props.labels ?? ['Low', 'Base', 'High'];
  return (
    <div className="range-row">
      {labels.map((label, i) => (
        <label key={label} className="range-cell">
          <span>
            {label}
            {props.unit ? ` (${props.unit})` : ''}
          </span>
          <input
            inputMode="decimal"
            value={vals[i]}
            onChange={(e) => {
              const v = vals.slice();
              v[i] = e.target.value;
              setVals(v);
              const n = v.map(num);
              props.onChange(
                n.every(Number.isFinite)
                  ? { low: n[0]! / scale, base: n[1]! / scale, high: n[2]! / scale }
                  : null,
              );
            }}
          />
        </label>
      ))}
    </div>
  );
}

export function MoneyRangeInput(props: {
  value?: Range;
  onChange: (r: Range | null) => void;
  currency: string;
  labels?: [string, string, string];
}) {
  const [vals, setVals] = useState(() =>
    props.value
      ? [props.value.low, props.value.base, props.value.high].map((c) => centsToInput(c))
      : ['', '', ''],
  );
  const labels = props.labels ?? ['Best', 'Likely', 'Worst'];
  return (
    <div className="range-row">
      {labels.map((label, i) => (
        <label key={label} className="range-cell">
          <span>
            {label} ({props.currency})
          </span>
          <input
            inputMode="decimal"
            value={vals[i]}
            onChange={(e) => {
              const v = vals.slice();
              v[i] = e.target.value;
              setVals(v);
              const c = v.map(parseMoney);
              props.onChange(
                c.every((x) => x !== null) ? { low: c[0]!, base: c[1]!, high: c[2]! } : null,
              );
            }}
          />
        </label>
      ))}
    </div>
  );
}

export function MoneyInput(props: {
  id?: string;
  value?: number;
  onChange: (c: number | null) => void;
  placeholder?: string;
}) {
  const [v, setV] = useState(centsToInput(props.value));
  return (
    <input
      id={props.id}
      inputMode="decimal"
      value={v}
      placeholder={props.placeholder}
      onChange={(e) => {
        setV(e.target.value);
        props.onChange(parseMoney(e.target.value));
      }}
    />
  );
}

/** Hours per weekday → minutes. */
export function CapacityInput(props: { value: WeekMinutes; onChange: (w: WeekMinutes) => void }) {
  const [vals, setVals] = useState(() =>
    props.value.map((m) => (m ? String(Math.round((m / 60) * 100) / 100) : '')),
  );
  const total = vals.reduce((a, v) => a + (Number(v) || 0), 0);
  return (
    <div className="capacity">
      <div className="capacity-grid">
        {WEEKDAYS.map((d, i) => (
          <label key={d} className="capacity-day">
            <span>{d}</span>
            <input
              inputMode="decimal"
              value={vals[i]}
              placeholder="0"
              aria-label={`${d} hours`}
              onChange={(e) => {
                const v = vals.slice();
                v[i] = e.target.value;
                setVals(v);
                props.onChange(
                  v.map((x) =>
                    Math.max(0, Math.min(1440, Math.round((Number(x) || 0) * 60))),
                  ) as WeekMinutes,
                );
              }}
            />
          </label>
        ))}
      </div>
      <p className="hint">Hours per day · {Math.round(total * 10) / 10} h a week</p>
    </div>
  );
}

export function TaskListInput(props: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  label?: string;
}) {
  const rows = props.value.length ? props.value : [''];
  return (
    <div className="task-list-input">
      {rows.map((t, i) => (
        <div key={i} className="row">
          <input
            aria-label={`${props.label ?? 'Item'} ${i + 1}`}
            value={t}
            placeholder={i === 0 ? props.placeholder : ''}
            onChange={(e) => {
              const v = rows.slice();
              v[i] = e.target.value;
              props.onChange(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && t.trim()) {
                e.preventDefault();
                props.onChange([...rows, '']);
              }
            }}
          />
          {rows.length > 1 && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${i + 1}`}
              onClick={() => props.onChange(rows.filter((_, j) => j !== i))}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => props.onChange([...rows, ''])}>
        + Add another
      </button>
    </div>
  );
}

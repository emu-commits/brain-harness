import type { Trace } from '../../core/engines/scenarios';
import type { Workspace } from '../../core/model/types';
import { Sheet } from './Sheet';

/** "Why this number?": the inputs, picks, multipliers and formula behind a forecast value. */
export function WhySheet(props: {
  value: string;
  trace: Trace;
  ws: Workspace;
  onClose: () => void;
}) {
  const { trace, ws } = props;
  const name = (id: string) => {
    const t = ws.tasks.find((x) => x.id === id);
    if (t)
      return `Task: ${t.title}${t.estimateMinutes ? ` (${t.estimateMinutes.low}/${t.estimateMinutes.base}/${t.estimateMinutes.high} min)` : ''}`;
    const a = ws.accounts.find((x) => x.id === id);
    if (a) return `Account: ${a.name}`;
    if (id.startsWith('capacity:')) return 'Your weekly capacity';
    const g = ws.goals.find((x) => x.successCriteria.some((c) => c.id === id));
    if (g) return `Success criterion: ${g.successCriteria.find((c) => c.id === id)!.description}`;
    return id;
  };
  return (
    <Sheet title="Why this number?" onClose={props.onClose}>
      <p className="why-value">
        <span className="muted">{trace.label}</span>
        <strong>{props.value}</strong>
      </p>
      <h3 className="eyebrow">Formula</h3>
      <p>{trace.formula}</p>
      {Object.keys(trace.picks).length > 0 && (
        <>
          <h3 className="eyebrow">Which of your ranges it uses</h3>
          <ul className="kv">
            {Object.entries(trace.picks).map(([k, v]) => (
              <li key={k}>
                <span>{k}</span>
                <span>{v === 'base' ? 'likely' : v === 'low' ? 'low / best' : 'high / worst'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {Object.keys(trace.multipliers).length > 0 && (
        <>
          <h3 className="eyebrow">Multipliers</h3>
          <ul className="kv">
            {Object.entries(trace.multipliers).map(([k, v]) => (
              <li key={k}>
                <span>{k}</span>
                <span>×{v}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {trace.notes.length > 0 && (
        <>
          <h3 className="eyebrow">Notes</h3>
          <ul className="plain">
            {trace.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
      {trace.inputs.length > 0 && (
        <details>
          <summary>Inputs ({trace.inputs.length})</summary>
          <ul className="plain small">
            {trace.inputs.map((i) => (
              <li key={i}>{name(i)}</li>
            ))}
          </ul>
        </details>
      )}
    </Sheet>
  );
}

import { lazy, Suspense } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useStore } from '../../store';
import { useSessionApi } from '../../session';
import { charterLine } from '../../../core/harness/hooks';
import { GapsPanel } from './GapsPanel';
import { ListView } from './ListView';
import { CharterView } from './CharterView';
import { MoneyView } from './MoneyView';

// dagre is large; load the graph view only when it's opened.
const GraphView = lazy(() => import('./GraphView').then((m) => ({ default: m.GraphView })));

const TABS = [
  ['questions', 'Questions'],
  ['list', 'List'],
  ['graph', 'Graph'],
  ['charter', 'Charter'],
  ['money', 'Money'],
] as const;

export function Plan() {
  const { goal, session } = useStore();
  const api = useSessionApi();
  const params = useParams();
  const tab = (TABS.find(([k]) => k === params.tab)?.[0] ??
    'questions') as (typeof TABS)[number][0];
  const editable = session?.mode === 'plan' && session.goalId === goal?.id;
  if (!goal) return null;
  const line = charterLine(goal);
  return (
    <div className="page plan">
      {line && <p className="charter-line">{line}</p>}
      {!editable && (
        <section className="gate" aria-label="Plan session">
          <div>
            <strong>Planning happens in its own session.</strong>
            <p className="muted small">
              You can look around; editing needs a Plan session. Planning and doing are kept apart
              on purpose.
            </p>
          </div>
          <button type="button" className="btn primary" onClick={() => void api.ensure('plan')}>
            Start Plan session
          </button>
        </section>
      )}
      <nav className="tabs" aria-label="Plan views">
        {TABS.map(([k, label]) => (
          <NavLink
            key={k}
            to={`/plan/${k}`}
            className={tab === k ? 'active' : ''}
            aria-current={tab === k ? 'page' : undefined}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      {tab === 'questions' && <GapsPanel editable={editable} />}
      {tab === 'list' && <ListView editable={editable} />}
      {tab === 'graph' && (
        <Suspense fallback={<p className="muted">Laying out the graph…</p>}>
          <GraphView editable={editable} />
        </Suspense>
      )}
      {tab === 'charter' && <CharterView editable={editable} />}
      {tab === 'money' && <MoneyView editable={editable} />}
    </div>
  );
}

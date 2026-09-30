import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useStore, withSettings } from './store';
import { MODE_LABEL, useSessionApi } from './session';
import { FirstRun } from './screens/FirstRun/FirstRun';
import { Today } from './screens/Today/Today';
import { Plan } from './screens/Plan/Plan';
import { Settings } from './screens/Settings/Settings';

export function App() {
  const { ready, ws } = useStore();
  const loc = useLocation();
  if (!ready) return <div className="loading" aria-busy="true" />;
  const hasGoals = ws.goals.length > 0;
  const bare = loc.pathname.startsWith('/welcome');
  const content = (
    <Routes>
      <Route path="/welcome" element={<FirstRun />} />
      <Route path="/today" element={hasGoals ? <Today /> : <Navigate to="/welcome" replace />} />
      <Route path="/plan" element={hasGoals ? <Plan /> : <Navigate to="/welcome" replace />} />
      <Route path="/plan/:tab" element={hasGoals ? <Plan /> : <Navigate to="/welcome" replace />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to={hasGoals ? '/today' : '/welcome'} replace />} />
    </Routes>
  );
  if (bare) return <div className="app bare">{content}</div>;
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <nav className="nav" aria-label="Main">
        <div className="brand" aria-hidden="true">
          <Logo />
        </div>
        <NavLink to="/today">
          <IconToday />
          <span>Today</span>
        </NavLink>
        <NavLink to="/plan">
          <IconPlan />
          <span>Plan</span>
        </NavLink>
        <NavLink to="/settings">
          <IconSettings />
          <span>Settings</span>
        </NavLink>
      </nav>
      <div className="main-col">
        <TopBar />
        <main id="main" tabIndex={-1}>
          {content}
        </main>
      </div>
    </div>
  );
}

function TopBar() {
  const { ws, goal, session, commit, clock } = useStore();
  const api = useSessionApi();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30000);
    return () => window.clearInterval(t);
  }, []);
  const minutes = session
    ? Math.max(0, Math.floor((Date.parse(clock.now()) - Date.parse(session.startedAt)) / 60000))
    : 0;
  return (
    <header className="topbar">
      <div className="goal-switch">
        {ws.goals.length > 1 ? (
          <select
            aria-label="Goal"
            value={goal?.id}
            onChange={async (e) => {
              const id = e.target.value;
              if (session) {
                const ok = await api.end();
                if (!ok) return;
              }
              await commit((w) => withSettings(w, { activeGoalId: id }));
            }}
          >
            {ws.goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.isDemo ? 'Demo · ' : ''}
                {g.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="goal-title">{goal?.title}</span>
        )}
        {goal?.isDemo && <span className="badge demo">Demo data</span>}
      </div>
      {session && (
        <div className={`session-chip mode-${session.mode}`}>
          <span className="dot" aria-hidden="true" />
          <span>
            {MODE_LABEL[session.mode]} session · {minutes} min
          </span>
          <button type="button" className="link-btn" onClick={() => void api.end()}>
            End
          </button>
        </div>
      )}
    </header>
  );
}

export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="7" cy="16" r="4" fill="currentColor" opacity=".45" />
      <circle cx="17" cy="8" r="4" fill="currentColor" opacity=".7" />
      <circle cx="17" cy="24" r="4" fill="currentColor" opacity=".7" />
      <circle cx="27" cy="16" r="4" fill="currentColor" />
      <path
        d="M10.5 14 14 10M10.5 18 14 22M20.5 10 24 14M20.5 22 24 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

const icon = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};
const IconToday = () => (
  <svg {...icon}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l2.5 2.5" />
  </svg>
);
const IconPlan = () => (
  <svg {...icon}>
    <circle cx="5" cy="12" r="2.2" />
    <circle cx="12" cy="6" r="2.2" />
    <circle cx="12" cy="18" r="2.2" />
    <circle cx="19" cy="12" r="2.2" />
    <path d="M7 11 10.2 7.3M7 13l3.2 3.7M13.8 7.3 17 11M13.8 16.7 17 13" />
  </svg>
);
const IconSettings = () => (
  <svg {...icon}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);

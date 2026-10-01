import { useStore } from '../../store';
import { pendingRevision } from '../../../core/harness/woop';
import { upsert } from '../../../core/model/factories';
import { saveCheckIn } from '../../actions';
import { fmtDate } from '../../format';
import { IfThenLine } from '../Today/Woop';

/**
 * A check-in said "not quite" to the if-then plan. Charter edits are Plan-only, so the draft
 * waits here until the user applies or dismisses it.
 */
export function RevisionBanner({ editable }: { editable: boolean }) {
  const { ws, goal, commit } = useStore();
  if (!goal) return null;
  const c = pendingRevision(ws, goal.id);
  if (!c) return null;
  return (
    <section className="card revision" aria-label="Revised if-then plan">
      <p className="eyebrow">From your check-in on {fmtDate(c.day)}</p>
      <p className="muted small">Your plan was:</p>
      <p>
        <IfThenLine text={goal.charter.obstaclePlan} />
      </p>
      <p className="muted small">You’d now put it:</p>
      <p className="woop-plan">
        <IfThenLine text={c.revisedPlan!} />
      </p>
      {editable ? (
        <div className="row-actions">
          <button
            type="button"
            className="btn primary small"
            onClick={() =>
              void commit((w) => {
                const g = w.goals.find((x) => x.id === goal.id)!;
                const next = {
                  ...w,
                  goals: upsert(w.goals, {
                    ...g,
                    charter: { ...g.charter, obstaclePlan: c.revisedPlan!.trim() },
                  }),
                };
                return saveCheckIn(next, { ...c, revisedPlanStatus: 'applied' });
              })
            }
          >
            Use the new version
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() =>
              void commit((w) => saveCheckIn(w, { ...c, revisedPlanStatus: 'dismissed' }))
            }
          >
            Keep the old one
          </button>
        </div>
      ) : (
        <p className="muted small">Start a Plan session to apply it.</p>
      )}
    </section>
  );
}

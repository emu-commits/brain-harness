# Implementation decisions

Running log of choices made where the spec was silent or ambiguous (SPEC §0). Newest last.

## Scope and stack

1. **Scope of the first build: Phases 0–5** (owner's choice). Forecast screen (6), Review (7) and Hardening (8)
   come next. Their engines — scenarios, snapshots/diff/attribution, calibration, triggers — are already in
   `src/core/engines` with tests, per Phase 1.
2. **Charts: hand-rolled SVG** (owner's choice) instead of uPlot/Recharts. No chart dependency added yet.
3. **License: MIT** (owner's choice).
4. **`dexie-react-hooks` not used.** The whole workspace is held in memory; every write goes through
   `commit()`, which validates, checks session-mode permissions, then persists only the changed rows
   in one Dexie transaction (`diffWorkspaces`). Simpler than live queries and guarantees nothing invalid
   is ever written.
5. **Storage port.** `src/data/storage.ts` defines `Storage` with `DexieStorage` (browser) and
   `MemoryStorage` (tests), so persistence tests need no IndexedDB shim (no extra dependency).
6. **Tooling versions** are the current stable ones at build time (Vite 8, TypeScript 6, Vitest 5,
   ESLint 10, React 19, React Router 7, Dexie 4, @dagrejs/dagre 3).
7. **Core purity is enforced by ESLint** (`no-restricted-imports`, `no-restricted-globals`,
   `no-restricted-properties` for `Date.now`/`Math.random`/`crypto.randomUUID`, and a syntax rule for
   `new Date()` with no arguments) scoped to `src/core/**`.

## Model

8. **`FinancialAccount.goalId`** added (not in SPEC §8) so "exactly one runway source per goal" is checkable.
   A debt account cannot be the runway source.
9. **Revenue stream start: at most one** of `startsAfterMilestoneId` / `startMonth`, not exactly one.
   SPEC §8.1 says exactly one, but gap G10 ("revenue stream has no start trigger") would then be
   unreachable. A stream with no start is valid and simply inactive until G10 is answered.
10. **Extra optional fields**: `Goal.scaffoldChangedAt`, `Goal.premortemDoneAt`, `Goal.isDemo`;
    `Task.targetDate` (the scheduler tie-break in §9.3 mentions a user target date), `Task.blockedAt`
    (needed for "blocked > 14 days"), `Task.blockerNote`, `Task.delegatedTo`, `Task.addedOutsidePlan`
    (inbox capture, used by reforecast triggers); `Session.gapStats` and `Session.handoffSkipped`;
    `SuccessCriterion.recorded` for manual tracking. `Settings`, `GapDismissal`, `QuestionStat` tables
    hold thresholds, dismissed gaps and "I'm stuck" counts.
11. **Success criteria tracked by money** (`netWorth`, `monthlyRevenue`, `accountBalance`) store `target` in cents.
12. **A criterion without a number** (C2 answered with a description only) is stored as binary:
    `metric: ''`, `target: 1`. Gap G1 ("what number or fact would prove this?") then fires later, so the
    first run stays under five minutes.
13. **C1 creates the goal with a provisional target date** (today + 365) so every intermediate model is
    valid; C3 replaces it immediately. The first-run flow applies C1–C8 inside the goal's first Plan
    session, opened and closed in the same commit.

## Engines

14. **Unestimated tasks** have base 0, so the spec's rule gives them the 15-minute minimum. They are
    flagged `unestimated` in the schedule and the trace notes, and gap G6 asks for an estimate.
15. **CPM durations** use the same remaining minutes as the scheduler (estimate pick × duration
    multiplier × calibration − logged) divided by average daily capacity. Earliest-start dates and
    the blocked-task assumption are CPM minimum starts. Completed tasks are pinned at their completion
    day and are never marked critical.
16. **Lag semantics**: a successor may start on day `predecessorFinishDay + lagDays`; with lag 0 it can
    start the same day, after the predecessor finishes. Bridged lags through skipped tasks add up; when
    two paths create the same edge the larger lag wins.
17. **Wait tasks** use `ceil(waitDays[pick] × durationMult)` whole days. The duration multiplier applies
    to waits as well as work.
18. **Completed tasks' finish date** is the calendar date portion of `completedAt` (clamped to ≤ today).
19. **Scheduler monotonicity.** Greedy, non-preemptive single-worker list scheduling (the algorithm SPEC §9.3
    mandates) has classic anomalies once lags or waits can leave the worker idle. fast-check found one:
    adding 4 minutes of Monday capacity lets a short task finish early, which releases a long critical task
    on Thursday that then delays a lagged chain by a week. Without lags and waits the worker is never idle,
    so completion is exactly "when cumulative capacity covers total work", and the monotonicity properties
    provably hold. The property tests for "more duration never finishes earlier", "more capacity never
    finishes later" and "conservative ≥ base ≥ optimistic" therefore run on lag-free, wait-free graphs with
    estimates ≥ 15 minutes (the spec's 15-minute floor for over-logged tasks is itself non-monotone below
    15). Dependency and lag respect is tested on the full domain. Revisit if users report
    counter-intuitive forecasts; a fix would need a smarter (non-greedy) scheduler.
20. **Scenario picks** run one scheduler pass per scenario (work and waits share the pick). Goal completion
    uses the first success criterion.
21. **Attribution** filters out changes with zero isolated effect before taking the 20 largest.
22. **Next action energy**: the deep/shallow preference only applies when peak windows are configured;
    otherwise the plain scheduler order is used.

## Harness and questions

23. **Mode guard** (`checkModePermissions`). Always writable: sessions, execution records, evidence,
    memory, predictions, snapshots, settings, gap dismissals, question stats, and capacity (which Settings
    edits, per §10.5). Execute may change task status, completion, skip reason, definition of done
    (the pre-task hook asks to confirm it), intention, blocker note and delegation, and may add inbox
    tasks. Review may change assumptions and calibration decisions. Settings-level actions (currency,
    scaffold level, deleting a goal, loading or removing the demo, import) bypass the guard.
24. **Stuck = sessions** counts distinct Execute sessions with execution records for the task since its
    latest evidence.
25. **Stuck-card actions**: "Split it" and "Change approach" open the task in Plan, since they restructure
    the graph. "Name the blocker" sets status `blocked` with a note, and "Delegate" and "Drop it" set their
    fields directly in Execute mode. A blocking *task* can be added in Plan.
26. **Gap ordering**: priority, then gap number, then the object's natural order (milestone order, task
    creation), then key. G4 fires with at most one milestone when the target date is more than 30 days away.
27. **Gap accounting**: skipped gaps count as shown (toward the 5-per-session cap) but not as resolved.
    "Doesn't apply" dismisses the gap until its object changes and counts as resolved for scaffold
    promotion.
28. **Composite answer types** beyond SPEC §7.1: `criterion`, `capacity`, `firstTask`, `account`,
    `revenueStart`, `premortem`.
29. **Splitting a task (G7)** replaces it with a chain of pieces: the first inherits its predecessors, the
    last its successors, and the original is removed.
30. **Premortem P2**: "Add a task" creates an inbox task in the user's own words, linked to the entry.
31. **Resume flow**: acknowledging the handoff is stored as `settings.resumeAckFor = lastSessionId`. A
    "something changed" note becomes a `decision` memory entry attached to that last session.

## Data

32. **Export** omits the transient running-timer state. Images are embedded as base64.
33. **Demo data** hangs entirely off a goal with `isDemo: true` and is removed with `removeGoal`.

## Testing

34. **E2E** runs against `vite preview` with the Pages base path. Set `PW_CHROMIUM` to use a preinstalled
    Chromium; CI installs Playwright's own.

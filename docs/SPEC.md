# GoalGraph — Product & Technical Specification (v2)

**A harness for the human brain.**
Web app first (static, GitHub Pages), native iPhone app later.

---

## 0. How to use this spec (read first, Claude Code)

- Build in the phase order in §15. Do not start a phase until the previous phase's acceptance criteria pass.
- `src/core/` is pure TypeScript with no React, DOM, network, or `Date.now()` calls. Everything the product computes lives there and is unit tested.
- There is **no LLM in the MVP.** The "intelligence" is a deterministic question engine plus deterministic calculation engines. An optional model-backed questioner is a post-MVP extension (§17).
- There is **no backend.** All data stays in the user's browser (IndexedDB). No analytics, no telemetry, no network calls after load.
- When the spec is ambiguous, choose the simplest option that keeps the core deterministic and testable, note the decision in `docs/DECISIONS.md`, and continue.
- Ask before adding any dependency not listed in §12.3.
- A `CLAUDE.md` starter is in §19. Copy it to the repo root in Phase 0.

---

## 1. Product summary

GoalGraph helps a person turn a large, ambiguous goal into a living execution model: a dependency graph of their own tasks, their own estimates, a deterministic time and money forecast, and a feedback loop that updates the forecast as reality arrives.

The distinguishing idea: **the user does all the thinking; the software runs the loop around their thinking.**

Most AI planning tools generate a plan for the user, who then reviews it, accepts it, and rarely executes it. GoalGraph inverts this. It asks precise questions, detects gaps, manages what the user sees and when, records predictions against outcomes, and does all the arithmetic. The plan is entirely the user's, which is why they follow it.

### Product thesis

> People don't need more tasks or more answers. They need a better model of how their own actions produce outcomes, and a structure that helps their own brain build and maintain that model.

### Pitch

> Most AI products think for you. GoalGraph makes you a sharper thinker about your own life.

---

## 2. The harness concept

An LLM on its own is capable but stateless, has a small working context, drifts on long tasks, forgets decisions, doesn't verify its own work, and loops when stuck. An **agent harness** doesn't make the model smarter; it manages state, context, the execution loop, and verification so the model can finish long-horizon work.

Human brains have the same failure modes: working memory holds about four chunks, intentions decay, attention drifts, people don't check their own work, and they stall on tasks without noticing. GoalGraph is a harness with a human in the model's seat.

**Design rule: the harness never reasons for the user. It only manages state, context, the loop, and verification.**

| Agent harness component | Human equivalent | GoalGraph module |
|---|---|---|
| System prompt | Why this goal matters; the main internal obstacle | **Charter**, shown at the start of every session |
| Context engineering | Working-memory limits (~4 chunks) | **Context assembler**: each screen shows only what the current step needs |
| Plan / todo tool | Holding the plan in your head | **Goal graph** (tasks, dependencies, milestones) |
| Plan mode vs execute mode | Planning and doing interfere (attention residue) | **Session modes**: Plan, Execute, Review |
| Hooks | Implementation intentions ("when X, I will Y") | **Hooks**: session-start, pre-task, post-task, session-end |
| Verification step | Self-grading "done" | **Definition of done + evidence** on every task |
| Memory files | Forgotten decisions and lessons | **Memory log** (decisions, lessons) |
| Compaction / resume | Losing the thread after a break | **Handoff note** written at session end, shown first on return |
| Loop detection | Stalling without noticing | **Stuck detector** |
| Tools / subagents | Resources, people, money | Explicit resources and delegation on tasks |
| Guardrails / permissions | Commitments that erode under pressure | **Commitments**, editable only in Plan mode |
| Token budget | Energy and attention | **Energy budget**: deep work routed to peak hours |
| Evals | Knowing whether you're getting better | **Calibration**: predictions vs actuals, tracked over time |

---

## 3. Product principles

1. **The user generates; the software asks and computes.** The app never proposes tasks, estimates, or dollar amounts. It proposes questions. (Curated static examples may be shown only after the user attempts an answer; see §7.4.)
2. **The model is the product.** The canonical artifact is the structured model: goal, charter, milestones, tasks, dependencies, assumptions, estimates, finances, predictions, actuals, evidence, snapshots.
3. **All numbers are deterministic.** Dates, schedules, critical path, balances, growth, scenarios, and calibration are computed by pure functions in `src/core/`. Same inputs, same outputs, every time.
4. **Every forecast number is explainable.** Tapping any forecast value shows the inputs, assumptions, and formula behind it.
5. **Uncertainty is first-class.** Estimates are ranges (low/base/high) entered by the user. Scenarios come directly from the user's own ranges, not hidden multipliers.
6. **Ask little, often.** No long questionnaires. At most 5 gap questions per planning session. First run under 5 minutes.
7. **Mirror, not oracle.** The app's authority comes from reflecting the user's own data back ("your last 10 tasks ran 1.4× your estimates"), never from its own opinions.
8. **Autonomy.** The app suggests a next action but the user always chooses. Language is descriptive, never prescriptive: "If you choose X, the model shows…", never "You should…".
9. **Private by construction.** No account, no server, no analytics, no network calls after load.
10. **Not financial advice.** Financial projections are hypothetical models of user-entered assumptions and are labeled as such everywhere they appear.

---

## 4. Psychological foundations (why each mechanic exists)

Claude Code: this section explains intent so implementation choices preserve it. Don't cite research in the UI.

| Mechanic | Principle | Where it appears |
|---|---|---|
| User writes every task and estimate | Generation effect; IKEA effect (ownership) | Everywhere |
| "Picture the day it's done. What proves it?" | Concrete, measurable goal setting | Charter flow |
| Main internal obstacle + if-then plan | Mental contrasting (WOOP); implementation intentions | Charter flow, Execute pre-task hook |
| "What has to be true just before this?" | Backward chaining is easier than forward decomposition | Plan mode |
| Estimate as a range, then "how long did the last similar thing take?" | Planning fallacy; reference-class thinking | Estimate questions |
| "It's [deadline] and this failed. Why?" | Premortem / prospective hindsight | Plan mode |
| Guess the goal date before the forecast is shown | Prediction then feedback builds calibration; surprise aids memory | Predict-then-reveal |
| Examples only after an attempt | Generation before exposure; avoids anchoring | Hints |
| Scaffolding fades with demonstrated skill | Expertise reversal effect | Scaffold levels |
| Handoff note with the next step | Resumption is easier with an explicit next action | Session end / resume |
| Plan and execute are separate sessions | Attention residue from task switching | Session modes |
| One next action shown, user can pick another | Autonomy; reduced choice load | Today screen |

---

## 5. The core loop and session modes

```
Load charter → assemble minimal context → user defines done → user acts
   → verify with evidence → record actual vs predicted
   → write memory + handoff note → reforecast → (repeat)
```

### 5.1 Session modes

A `Session` has exactly one mode. Mode determines what can be edited.

| Mode | Purpose | Typical length | Can edit |
|---|---|---|---|
| **Plan** | Build and revise the model | 10–20 min, ~weekly | Everything, including charter and commitments |
| **Execute** | Do one or more tasks | Any | Task status, actuals, evidence, notes, handoff. Can add a new task to an inbox (unplanned) but cannot restructure the graph or edit commitments |
| **Review** | Look at reality vs model; decide on reforecast | 5–10 min, ~weekly | Calibration acceptance, assumption status, memory log |

Switching modes ends the current session and starts a new one. This is deliberate friction.

### 5.2 Hooks

Hooks are deterministic event handlers in `src/core/harness/hooks.ts` that return prompts for the UI to show.

| Hook | Fires | Prompts |
|---|---|---|
| `sessionStart` | Any session begins | Charter one-liner (why + obstacle plan). If last session > `resumeThresholdDays` (default 3) ago: show handoff note first, then "Has anything changed since then?" |
| `preTask` | User starts a task | Confirm definition of done (required). Predict time for this sitting (optional, default the estimate). If no intention set: "When and where will you do this?" |
| `postTask` | User stops or completes a task | Actual minutes (prefilled from timer if used), actual cost, evidence (optional but encouraged), "What surprised you?" (optional) |
| `sessionEnd` | Session ends | Handoff note: "Where did you stop, and what's the very next step?" (required for Execute; skippable with one tap but tracked). Plan/Review: "Anything decided or learned that future-you needs?" → Memory log |
| `weekly` | 7 days since last Review | Today screen shows a Review prompt card |

### 5.3 Stuck detector

A task is **stuck** if any of:

- status `inProgress` across ≥ 3 Execute sessions with no new evidence and no completion, or
- logged minutes > `estimate.high × 1.5`, or
- status `blocked` for > 14 days.

When stuck, show (non-blocking) a card: "This has been open a while. What would help?" Options: split it (opens split flow), change approach (edit task), name the blocker (creates/links a blocking task), delegate (add a note of who), drop it (status `skipped` with reason). Thresholds are configurable.

### 5.4 Context assembler

`assembleContext(model, screen, now)` returns only what a screen needs. For the Execute context card:

1. Charter one-liner
2. Handoff note from the last session touching this goal
3. The task: title, definition of done, estimate range, intention (when/where)
4. Its immediate dependencies (just resolved) and what it unlocks (count + titles, max 3)
5. The one assumption it tests, if any

Nothing else. The full graph is one tap away but never on the execute card.

---

## 6. User journeys

### 6.1 First run (≤ 5 minutes, no account)

1. Landing: **"What are you trying to make happen?"** Large text field, placeholder "I want to…". No sign-up, no onboarding carousel.
2. Charter flow (§7.3 questions C1–C8), one question per screen, each answerable in under a minute.
3. Result: a goal with a measurable criterion, a charter, one milestone, one task with a definition of done and an intention.
4. Land on Today with that task as the next action. Show a subtle prompt: "Plan more when you're ready."

### 6.2 Plan session

1. `sessionStart` hook.
2. Gap detector (§7.2) runs; show up to 5 highest-priority gap questions, one at a time.
3. User can also freely add/edit milestones, tasks, dependencies, assumptions, finances in list or graph view.
4. If the premortem has never been done, or the goal's target date/criterion changed, offer the premortem (§7.3 P1–P2).
5. If the graph changed materially (any task added/removed, estimate changed > 25%, dependency changed): **predict-then-reveal** (§9.8), then show the forecast diff.
6. `sessionEnd` hook → memory log.

### 6.3 Execute session

1. `sessionStart` hook.
2. Today screen shows **one** suggested next action (§10.1 ordering) with its context card, plus "Pick a different task."
3. Start → `preTask` hook → optional timer → Stop/Complete → `postTask` hook.
4. Repeat or end → `sessionEnd` hook (handoff note).

### 6.4 Review session

1. `sessionStart` hook.
2. Calibration summary (§9.6): predicted vs actual for tasks since last review, plus any suggested multiplier.
3. Assumption check: for each assumption touched by completed tasks, "Did this hold up?" → supported / contradicted / revised (with new range).
4. Reforecast triggers (§9.9) listed; user chooses Reforecast / Keep current model.
5. If reforecast: snapshot, then "What changed" diff (§9.10).
6. `sessionEnd` hook → memory log ("lesson" prompt).

### 6.5 Returning after absence

If > `resumeThresholdDays` since last session: before anything else, show the last handoff note and "Has anything changed?" with quick options (nothing / something changed → free text memory entry, optional jump to Plan).

---

## 7. Question engine

The question engine replaces the LLM. It is deterministic and lives in `src/core/questions/`.

### 7.1 Question schema

```ts
type AnswerType =
  | 'text' | 'longText' | 'number' | 'money' | 'range' | 'moneyRange'
  | 'minutesRange' | 'date' | 'choice' | 'multiChoice' | 'taskList' | 'ifThen';

interface Question {
  id: string;                 // stable, e.g. 'C2', 'G3', 'P1'
  stage: 'charter' | 'gap' | 'premortem' | 'estimate' | 'review' | 'hook';
  prompt: string;             // may contain {placeholders} filled from context
  helper?: string;            // one short line under the prompt
  answerType: AnswerType;
  writes: WriteTarget;        // where the answer goes in the model
  appliesTo?: 'goal' | 'milestone' | 'task' | 'assumption';
  example?: ExampleRef;       // shown only after an attempt (§7.4)
  minScaffoldLevel?: 1 | 2 | 3;
  followUps?: string[];       // question ids to queue after this one
}
```

`WriteTarget` is a typed discriminated union (e.g. `{ kind: 'goal.charter.why' }`, `{ kind: 'task.definitionOfDone', taskId }`, `{ kind: 'createTask', milestoneId }`). Applying an answer is a pure function `applyAnswer(model, question, answer) → Result<Model, ValidationError[]>`.

Question text lives in `src/core/questions/bank.ts` as data, so it can be revised without touching logic.

### 7.2 Gap detector

`detectGaps(model, now): Gap[]` returns deterministic gaps, each mapped to a question, sorted by priority then stable id. The Plan session shows at most `maxGapsPerSession` (default 5).

| Gap | Condition | Question (paraphrase) | Priority |
|---|---|---|---|
| G1 | Goal has no measurable success criterion | "What number or fact would prove this is done?" | 1 |
| G2 | No weekly capacity set | "How many hours a week can you realistically give this? Which days?" | 1 |
| G3 | Milestone has no tasks | "What's the first concrete action toward {milestone}?" | 2 |
| G4 | Only one milestone and goal not near | "What has to be true just before {earliest milestone}?" (backward chain) | 2 |
| G5 | Task has no definition of done | "How will you know {task} is done?" | 2 |
| G6 | Task estimate missing or low = high | "Best case, likely, worst case: how long will {task} take?" | 3 |
| G7 | Task base estimate > `splitThresholdMinutes` (default 480) | "{task} is big. Can it be split into smaller pieces?" | 3 |
| G8 | Task (not first in its milestone) has no dependencies | "Does anything need to happen before {task}?" | 3 |
| G9 | Assumption has no validating task | "How could you test '{assumption}' early and cheaply?" | 3 |
| G10 | Revenue stream has no start trigger | "What needs to be done before this starts earning?" | 3 |
| G11 | Financial goal with no accounts | "What money are you starting with?" | 2 |
| G12 | Premortem never done and ≥ 3 milestones | Offer premortem | 4 |

Gaps the user dismisses are suppressed for that object until it changes.

### 7.3 Core question sequences

**Charter (first run)**

| id | Prompt | Writes |
|---|---|---|
| C1 | What are you trying to make happen? | goal.title |
| C2 | Picture the day this is done. What can you point to that proves it? | successCriterion (description + metric + target + unit) |
| C3 | By when? | successCriterion.deadline, goal.targetDate |
| C4 | Why does this matter to you? | charter.why |
| C5 | What's the thing inside *you* most likely to get in the way? | charter.obstacle |
| C6 | When that shows up, what will you do? ("When ___, I will ___") | charter.obstaclePlan (ifThen) |
| C7 | What has to be true just before you reach this? | createMilestone |
| C8 | What's one action under an hour you could take this week toward that? Then: when and where will you do it? How will you know it's done? | createTask (+ intention, definitionOfDone) |

**Premortem**

| id | Prompt | Writes |
|---|---|---|
| P1 | It's {deadline} and this goal failed. Write down the most likely reasons. | premortem entries (list) |
| P2 | For each: what could you do now to make it less likely? Add a task, an assumption to test, or leave it as a known risk. | per entry: createTask / createAssumption / mark risk |

**Estimate** (used whenever a task estimate is requested)

| id | Prompt | Writes |
|---|---|---|
| E1 | Best case, likely, worst case? | task.estimateMinutes (range) |
| E2 | Think of the last similar thing you did. How long did it actually take? | task.referenceMinutes (optional; shown next to the estimate, may prompt revising E1) |

If calibration data exists for the task's category, show it after E1 (not before): "Your similar tasks have run about 1.3× your likely estimate."

### 7.4 Examples and hints

- Each question may reference a curated static example (`src/core/questions/examples.ts`), e.g. what a good definition of done looks like.
- **An example is only revealed after the user submits an attempt, or taps "I'm stuck."** Taps on "I'm stuck" are recorded locally (count per question) to inform scaffold level.
- Examples are generic illustrations of *form*, never content for the user's specific goal.

### 7.5 Scaffold levels (fading support)

| Level | Behavior |
|---|---|
| 1 Guided (default) | Structured fields, helper text, example available after attempt |
| 2 Prompted | Shorter prompts, no helper text, example still available |
| 3 Open | Gap questions only surface for priority 1–2 gaps; user plans freely |

Promotion: from 1→2 after 3 planning sessions where the user resolves ≥ 80% of shown gaps without "I'm stuck"; 2→3 similarly. User can set the level manually in Settings. Never demote automatically.

---

## 8. Domain model

All types in `src/core/model/`. IDs are UUID v4 strings generated by an injected `IdGen`. Dates are ISO `YYYY-MM-DD` (local calendar dates); timestamps are ISO 8601 strings. **Money is integer minor units (cents).**

```ts
type ID = string;
type ISODate = string;      // 'YYYY-MM-DD'
type ISOTime = string;      // full ISO timestamp
type Cents = number;        // integer
interface Range { low: number; base: number; high: number }  // low <= base <= high

interface Goal {
  id: ID; title: string; status: 'active' | 'paused' | 'achieved' | 'abandoned';
  targetDate: ISODate; currency: string; createdAt: ISOTime;
  charter: Charter; successCriteria: SuccessCriterion[];
  scaffoldLevel: 1 | 2 | 3;
}

interface Charter {
  why: string; obstacle: string; obstaclePlan: string;   // if-then text
  premortem: PremortemEntry[]; commitments: Commitment[];
}

interface PremortemEntry { id: ID; reason: string; response: 'task' | 'assumption' | 'risk'; linkedId?: ID }

interface Commitment {                  // guardrails, editable in Plan mode only
  id: ID; text: string;
  rule?: { kind: 'maxWeeklyMinutes'; value: number }
       | { kind: 'maxSpendBeforeMilestone'; cents: Cents; milestoneId: ID };
}

interface SuccessCriterion {
  id: ID; description: string; metric: string; unit: string;
  target: number; minimum?: number; stretch?: number; deadline: ISODate;
  trackedBy: { kind: 'tasks' }                      // done when all milestones done
           | { kind: 'netWorth' } | { kind: 'monthlyRevenue' }
           | { kind: 'accountBalance'; accountId: ID }
           | { kind: 'manual' };                    // user records the value
}

interface Milestone { id: ID; goalId: ID; title: string; order: number; definitionOfDone: string }

interface Task {
  id: ID; goalId: ID; milestoneId?: ID;             // no milestoneId = inbox
  title: string; kind: 'work' | 'wait' | 'decision';
  definitionOfDone: string;
  estimateMinutes?: Range;                          // work & decision
  waitDays?: Range;                                 // wait: calendar time, no capacity used
  referenceMinutes?: number;                        // from E2
  cost?: Range;                                     // cents, incurred at finish
  status: 'ready' | 'inProgress' | 'blocked' | 'completed' | 'skipped';
  priority: 1 | 2 | 3;                              // 1 high
  energy: 'deep' | 'shallow';
  category?: string;                                // for calibration grouping
  earliestStart?: ISODate;
  intention?: { when: string; where: string; ifThen?: string };
  testsAssumptionId?: ID;
  skippedReason?: string;
  createdAt: ISOTime; completedAt?: ISOTime;
}
// 'ready' vs 'blocked-by-dependency' is DERIVED, not stored. Stored 'blocked'
// means user-declared external blocker.

interface Dependency { id: ID; fromTaskId: ID; toTaskId: ID; lagDays: number }  // finish-to-start only in MVP

interface Assumption {
  id: ID; goalId: ID; statement: string; unit?: string; value?: Range;
  confidence: 'low' | 'medium' | 'high';
  status: 'untested' | 'supported' | 'contradicted' | 'revised';
  history: { at: ISOTime; value?: Range; status: Assumption['status'] }[];
}

interface Capacity {
  goalId: ID;
  minutesByWeekday: [number, number, number, number, number, number, number]; // Sun..Sat
  peakWindows?: { weekday: number; start: string; end: string }[];           // 'HH:MM'
}

interface Session {
  id: ID; goalId: ID; mode: 'plan' | 'execute' | 'review';
  startedAt: ISOTime; endedAt?: ISOTime; handoffNote?: string;
}

interface ExecutionRecord {
  id: ID; taskId: ID; sessionId: ID; startedAt: ISOTime; endedAt: ISOTime;
  minutes: number; cost?: Cents; predictedMinutes?: number; surprise?: string;
}

interface Evidence {
  id: ID; taskId: ID; kind: 'note' | 'url' | 'metric' | 'amount' | 'image';
  text?: string; url?: string; metricName?: string; value?: number;
  imageBlobId?: ID; createdAt: ISOTime;
}

interface MemoryEntry { id: ID; goalId: ID; kind: 'decision' | 'lesson'; text: string; createdAt: ISOTime; sessionId: ID }

interface Prediction {
  id: ID; goalId: ID; subject: 'goalDate' | 'milestoneDate' | 'taskMinutes'; subjectId: ID;
  predicted: string | number;  // ISODate or minutes
  computed?: string | number;  // model's value at the time
  realized?: string | number;  // filled when known
  createdAt: ISOTime;
}

interface CalibrationDecision { id: ID; goalId: ID; category: string | '*'; multiplier: number; acceptedAt: ISOTime }

interface FinancialAccount {
  id: ID; name: string;
  type: 'cash' | 'savings' | 'investment' | 'retirement' | 'business' | 'debt' | 'other';
  balance: Cents;                 // debts: positive number = amount owed
  annualRate: Range;              // growth rate for assets, interest rate for debt (e.g. 0.06)
  monthlyContribution: Cents;     // external inflow (assets) or payment (debt)
  isRunwaySource: boolean;        // exactly one per goal with finances; goal costs/revenue settle here
}

interface CashFlow {
  id: ID; goalId: ID; name: string; amount: Cents;   // signed: + inflow, − outflow
  accountId: ID; startMonth: string; endMonth?: string;  // 'YYYY-MM'
  recurrence: 'once' | 'monthly'; inflationAdjusted: boolean;
}

interface RevenueStream {
  id: ID; goalId: ID; name: string; accountId: ID;
  startsAfterMilestoneId?: ID; startMonth?: string;   // one of the two
  rampMonths: Range; targetMonthly: Range;            // cents
}

interface ScenarioSettings {
  goalId: ID;
  inflationAnnual: number;                           // default 0.03
  horizonMonths: number;                             // default 120
  multipliers: Record<ScenarioId, { duration: number; capacity: number; cost: number; revenue: number }>; // default all 1
}
type ScenarioId = 'conservative' | 'base' | 'optimistic';

interface ForecastSnapshot {
  id: ID; goalId: ID; createdAt: ISOTime; engineVersion: string;
  reason: 'initial' | 'manual' | 'reforecast' | 'planChange';
  inputsHash: string; inputs: ForecastInputs;         // full copy, for diffing
  outputs: Record<ScenarioId, ForecastOutput>;
}
```

### 8.1 Validation (enforced on every write)

- Non-empty titles; `low ≤ base ≤ high`; minutes ≥ 0; costs ≥ 0; money is integer.
- Dependencies reference existing tasks in the same goal; no self-dependency; no cycles.
- Exactly one `isRunwaySource` account if any accounts exist.
- `RevenueStream` has exactly one of `startsAfterMilestoneId` / `startMonth`.
- `Commitment` rules and charter only change inside a Plan session.
- Invalid writes are rejected with typed errors; the model is never persisted in an invalid state.

---

## 9. Deterministic engines (`src/core/engines/`)

All engines are pure: `(inputs, config) → outputs`. The current date is passed in, never read.

### 9.1 Graph

- Build adjacency from `Dependency` (finish-to-start).
- Cycle detection via Kahn's algorithm; on failure return the set of tasks in cycles (Tarjan SCC for the precise members).
- Skipped tasks are removed from the graph; their dependents inherit their predecessors (edges bridged).

### 9.2 Critical path (CPM)

Computed on **calendar-day durations**:

- work/decision task: `durationDays = estimateMinutes[pick] / averageDailyCapacity`
- wait task: `durationDays = waitDays[pick]`
- plus `lagDays` on edges.

Forward pass (ES, EF), backward pass (LS, LF), float = LS − ES. Critical if `float ≤ 0.01` days. Completed tasks have duration 0 and are pinned.

Note: CPM here identifies which chains drive the finish date and which tasks have slack. It does not produce the schedule; one person executes work serially (§9.3).

### 9.3 Scheduler (single-person, capacity-based)

Produces planned start/finish dates. Day-by-day simulation from `today`:

```
remaining(task) =
  work/decision: max(estimate[pick] × durationMult × calibration(category) − loggedMinutes, 0)
                 (if 0 and not completed → 15 minutes)
  wait: waitDays[pick] calendar days, consumes no capacity

for day = today, today+1, … until all tasks done (or horizon → error "unschedulable"):
  capacityToday = minutesByWeekday[weekday(day)] × capacityMult
  start any wait task whose predecessors finished (+lag) and earliestStart ≤ day
  while capacityToday > 0:
    candidates = work tasks not done, predecessors finished (+lag elapsed), earliestStart ≤ day,
                 status ≠ 'blocked'
    if a task is already in progress in the simulation: continue it (no preemption)
    else pick by: critical first → float asc → priority asc → user targetDate asc → createdAt asc → id asc
    consume min(capacityToday, remaining)
  finish wait tasks whose duration elapsed
```

- User-`blocked` tasks: scheduled starting `today + blockedAssumeDays` (default 7) and flagged as an assumption in the output trace.
- If total capacity is zero, return an error "No weekly capacity set" (maps to gap G2).
- Milestone date = latest finish of its tasks. Task-based goal completion = latest milestone date.
- All tie-breaks above are mandatory so fixtures are stable.

### 9.4 Financial projection

Monthly steps `m = 0 … horizonMonths`, starting the month of `today`. Per scenario:

```
for each month m:
  for each account a (in id order):
    r_month = (1 + annualRate[pick])^(1/12) − 1
    growth = roundCents(startBalance(a) × r_month)          // debts: interest accrues to balance owed
    balance += growth
    balance += monthlyContribution (assets)  |  balance −= min(payment, balance) (debts)
  apply CashFlows active in m (inflation-adjusted amounts × (1+inflation)^(m/12))
  apply goal costs: for each task scheduled to finish in month m: runway −= cost[pick] × costMult
  apply revenue: for each stream active in m:
      k = m − startMonthIndex + 1
      monthly = targetMonthly[pick] × revenueMult × min(1, k / max(1, rampMonths[pick]))
      runway += roundCents(monthly)
  record balances; netWorth = Σ assets − Σ debts
runwayExhaustedMonth = first m where runway account < 0 (else null)
```

- Order within a month is fixed as written (growth on starting balance, then flows).
- `roundCents` = round half away from zero to integer cents. Round at each step.
- Revenue stream start: `startMonth`, or the month after its milestone's scheduled completion.
- Real (inflation-adjusted) display: `real = nominal / (1+inflation)^(m/12)`; toggle in UI.

### 9.5 Scenarios

Scenarios come from the user's own ranges:

| Input | Conservative | Base | Optimistic |
|---|---|---|---|
| Task duration | high | base | low |
| Wait duration | high | base | low |
| Task cost | high | base | low |
| Revenue target | low | base | high |
| Revenue ramp months | high | base | low |
| Account return rate | low | base | high |
| Debt interest rate | high | base | low |

Optional multipliers (§8 `ScenarioSettings`) default to 1 and are editable in an "advanced" panel. Every scenario output records which picks and multipliers it used.

Goal completion per scenario:
- `trackedBy.tasks`: scheduler's goal completion.
- `netWorth` / `monthlyRevenue` / `accountBalance`: first month the tracked value ≥ target, or null ("not reached within horizon").
- `manual`: no computed date; show last recorded value.

Never display a "probability." Show scenario ranges.

### 9.6 Calibration

For completed work tasks with a base estimate > 0:

```
ratio = actualTotalMinutes / estimate.base
suggestedMultiplier(category) = exp(median(ln(ratio))) over the most recent N (default 10) tasks in that category
```

- Requires ≥ 5 tasks in a category; else fall back to all categories (`'*'`); else none.
- Shown in Review and after E1. **Applied only when the user accepts** (stored as `CalibrationDecision`), and only to remaining (uncompleted) tasks.
- Date calibration: for each `Prediction` of `goalDate`/`milestoneDate` with a `realized` value, error in days = realized − predicted. Show median absolute error over time as the user's "forecasting skill" trend.

### 9.7 Explainability traces

Every `ForecastOutput` value carries a `trace`: the list of input ids, picks, multipliers, and formula name that produced it. The UI's "Why this number?" sheet renders the trace.

### 9.8 Predict-then-reveal

Before showing a changed forecast in a Plan session (or at first forecast), ask: "Before you look: when do you think you'll hit {criterion}?" (date picker, skippable). Store a `Prediction` with `predicted` and the model's `computed` value, then reveal the forecast with the user's guess marked on the chart. When the milestone/goal actually completes, fill `realized`.

### 9.9 Reforecast triggers

Evaluated in Review and on task completion (configurable thresholds):

- A task's actual > 125% of base estimate
- A task's actual cost > 115% of base cost
- A critical-path task finishes later than its scheduled finish
- An assumption marked contradicted or revised
- A task added/removed or dependency changed outside a Plan session (inbox tasks)
- Recorded revenue differs from the base scenario by > 20% in a month
- User requests it

Triggers produce a prompt; they never reforecast silently.

### 9.10 Snapshots and "What changed"

- Every accepted reforecast, and the first forecast, creates a `ForecastSnapshot` storing full inputs and outputs.
- `diffSnapshots(a, b)` returns:
  1. **Input changes**: by object id and field, old → new.
  2. **Output deltas**: goal date, milestone dates, total cost, runway month, net worth at target date, per scenario.
  3. **Attribution** (base scenario, goal date and net worth only): apply each input change individually to snapshot `a`'s inputs, recompute, and report its isolated effect. Label as "approximate contribution" since effects aren't strictly additive. Cap at the 20 largest changes.
- UI always offers "Original plan vs current" (first snapshot vs latest).

### 9.11 Next-action selection

Today's suggested action = first ready work/decision task by the scheduler's ordering, adjusted by energy: if the current time falls in a peak window, prefer `deep` tasks; otherwise prefer `shallow`. The user can always pick any other ready task.

---

## 10. Screens and information architecture

Mobile-first responsive layout (primary target: iPhone Safari, then desktop). Bottom tab bar on narrow screens, side rail on wide.

1. **Today** (Execute)
2. **Plan**
3. **Forecast**
4. **Review**
5. **Settings**

Goal switcher at top when more than one goal exists.

### 10.1 Today

```
[Charter one-liner: why · if-then]

Last time: "Stopped mid-outline; next: write section 3 intro."

NEXT
Build customer interview script
Done when: 10 questions, reviewed once
45–90 min · unlocks 3 tasks
[ Start ]          Pick a different task

2 more ready · 1 blocked · 1 stuck
Forecast (base): Dec 2028 (+4 days since last week)
[Review is due]  (if weekly hook fired)
```

### 10.2 Plan

- **List view**: milestones (with progress bars by completed estimated minutes) → tasks. Inline edit everything. This is the accessible equivalent of the graph.
- **Graph view**: layered DAG (dagre), SVG, pan/zoom (pointer + pinch), tap to focus a node and its neighbors, collapse/expand milestones, toggle critical-path highlight, state colors (completed / ready / in progress / blocked / future / stuck).
- **Gaps panel**: the session's gap questions, one at a time.
- **Charter**: why, obstacle, if-then, premortem, commitments.
- **Money**: accounts, cash flows, revenue streams (Plan mode only).

### 10.3 Forecast

- Scenario chart (line): conservative / base / optimistic, toggle metric: goal progress (cumulative planned minutes), net worth, runway cash, monthly revenue.
- User predictions marked on the chart.
- Summary: target date, modeled completion (per scenario), difference, runway exhausted month (if any).
- "What changed" (latest diff) and "Original vs current."
- Most influential assumptions: rank inputs by effect on base goal date and net worth using the one-at-a-time method (swap base → low and base → high).
- Financial disclaimer text on this screen.

### 10.4 Review

Calibration, assumption check, triggers, reforecast decision, memory log, forecasting-skill trend.

### 10.5 Settings

Scaffold level, thresholds, capacity, currency, inflation/horizon, data export/import, delete all data, storage status (persistent or not), install-to-home-screen instructions, disclaimer, about/license.

### 10.6 Copy and tone

- Calm, analytical, private. Questions, not commands.
- Never: "You should…", "The best path is…", "You will earn…".
- Use: "If you choose…", "This scenario assumes…", "At a hypothetical 6% annual return, the modeled balance is…".
- No streaks, badges, confetti, or gamification. The reward is watching your own calibration improve and your forecast firm up.
- No chatbot bubbles.

---

## 11. Persistence, offline, privacy

- **IndexedDB via Dexie.** One table per entity, normalized (no graph blob). Images stored as Blobs in a separate table.
- **Schema versioning** from v1 with Dexie migrations. Export format carries `schemaVersion`; import runs migrations.
- **Export / import** (JSON, plus images as base64 in the same file). Import validates fully before writing; on failure, nothing changes.
- **Storage durability**: call `navigator.storage.persist()` on first save and show its status in Settings. Browsers may evict site data (Safari in particular can clear script-writable storage for sites not visited recently unless installed to the home screen; verify current behavior during implementation). Mitigations: prompt the user to install to home screen on iOS; show a gentle "last exported N days ago" reminder in Settings after 14 days.
- **Offline**: PWA with a service worker precaching the app shell. Everything works offline after first load.
- **Privacy**: no accounts, no network calls after load, no analytics, no third-party fonts/CDNs at runtime (bundle everything). The public repo contains only code and fictional demo data.
- **Demo mode**: optional fictional sample goal, clearly labeled, loadable from Settings, deletable in one tap. Never mixed with real data.

---

## 12. Technical architecture

### 12.1 Hosting

- Public GitHub repo, deployed to **GitHub Pages** via GitHub Actions (`actions/upload-pages-artifact` + `actions/deploy-pages`) on push to `main`.
- Project-page base path: Vite `base: '/<repo-name>/'` (configurable via env).
- **Hash-based routing** (`/#/today`) to avoid Pages 404s on deep links.
- Static only. No server functions.

### 12.2 Layering

```
src/core/         Pure TS domain: model, validation, engines, harness, questions. No React/DOM.
src/data/         Dexie DB, repositories, migrations, export/import. Maps DB ↔ core model.
src/app/          React UI: routes, screens, components, hooks into data layer.
fixtures/         Language-agnostic JSON test fixtures (input + expected output) for engines.
```

The core is written so it could be ported to Swift later with `fixtures/` as the conformance suite.

Dependency injection for: `Clock` (now), `IdGen`, storage. Tests use a fake clock and in-memory storage.

### 12.3 Stack (approved dependencies)

Use current stable versions at implementation time.

| Purpose | Choice |
|---|---|
| Build | Vite + TypeScript (`strict: true`) |
| UI | React |
| Routing | React Router (hash router) |
| Storage | Dexie (+ `dexie-react-hooks` for live queries) |
| Graph layout | `@dagrejs/dagre` (render with own SVG) |
| Charts | A lightweight chart lib (uPlot or Recharts; pick one, record in DECISIONS.md) |
| PWA | `vite-plugin-pwa` |
| Unit tests | Vitest |
| Property tests | fast-check |
| E2E smoke | Playwright |
| Lint/format | ESLint + Prettier |

Styling: plain CSS with custom properties (light/dark via `prefers-color-scheme`). No UI kit unless approved.

### 12.4 Accessibility

- All interactive elements keyboard-accessible with visible focus.
- Proper labels on inputs; charts have text summaries; graph has the list view as its equivalent.
- Respect `prefers-reduced-motion`; support browser text zoom to 200% without layout breakage.
- Target WCAG 2.2 AA color contrast in both themes.

---

## 13. Repository structure

```
goalgraph/
├── CLAUDE.md
├── README.md
├── LICENSE                      # owner to choose
├── docs/
│   ├── SPEC.md                  # this document
│   └── DECISIONS.md             # running log of implementation decisions
├── .github/workflows/deploy.yml
├── fixtures/
│   ├── graph/*.json
│   ├── schedule/*.json
│   ├── finance/*.json
│   └── calibration/*.json
├── src/
│   ├── core/
│   │   ├── model/               # types, factories
│   │   ├── validation/
│   │   ├── engines/
│   │   │   ├── graph.ts
│   │   │   ├── cpm.ts
│   │   │   ├── scheduler.ts
│   │   │   ├── finance.ts
│   │   │   ├── scenarios.ts
│   │   │   ├── calibration.ts
│   │   │   ├── triggers.ts
│   │   │   ├── snapshots.ts     # hash, diff, attribution
│   │   │   └── nextAction.ts
│   │   ├── harness/
│   │   │   ├── sessions.ts
│   │   │   ├── hooks.ts
│   │   │   ├── context.ts
│   │   │   ├── stuck.ts
│   │   │   └── scaffold.ts
│   │   ├── questions/
│   │   │   ├── bank.ts
│   │   │   ├── examples.ts
│   │   │   ├── gaps.ts
│   │   │   └── apply.ts
│   │   └── util/                # money, dates, rounding, ids, clock
│   ├── data/
│   │   ├── db.ts
│   │   ├── migrations.ts
│   │   ├── repositories/
│   │   └── exportImport.ts
│   └── app/
│       ├── main.tsx
│       ├── routes.tsx
│       ├── screens/{Today,Plan,Forecast,Review,Settings,FirstRun}/
│       ├── components/
│       └── styles/
└── tests/
    ├── core/                    # unit + property tests
    └── e2e/
```

---

## 14. Testing strategy

### Unit (core, required before UI for each engine)

Compound growth, rounding, cash flows, revenue ramp, debt accrual, scenario picks, cycle detection, CPM, scheduler (including waits, lags, earliest start, blocked tasks, zero capacity), calibration median/log math, trigger evaluation, snapshot hash stability, diff and attribution, gap detection, answer application, stuck detection, scaffold promotion.

### Fixtures

Each engine has JSON fixtures `{ description, inputs, expected }` in `fixtures/`. Tests load and assert exact equality. These are the future cross-language conformance suite, so keep them self-contained (no TS-only constructs).

### Property tests (fast-check)

- Increasing any task duration never makes projected completion earlier.
- Increasing capacity never makes projected completion later.
- Increasing a cost never reduces total cost or ending runway.
- Adding a positive contribution never reduces ending assets (all else equal).
- Removing a dependency never makes any task's earliest start later.
- Conservative completion ≥ base ≥ optimistic.
- Scheduler output respects every dependency and lag.
- Export → import round-trips to an identical model.
- `applyAnswer` never produces a model that fails validation.

### E2E smoke (Playwright)

First run to Today; complete a task with actuals; plan session with a gap question; forecast renders three scenarios; export/import; app loads and works offline after first visit.

---

## 15. Build phases and acceptance criteria

### Phase 0 — Scaffold and deploy
- Vite + React + TS strict, ESLint/Prettier, Vitest, CLAUDE.md, docs/, GitHub Actions deploy.
- **Accept:** `npm run build` and `npm test` pass; placeholder app is live on GitHub Pages at the repo path with hash routing working on refresh.

### Phase 1 — Core model and engines
- Types, validation, graph, CPM, scheduler, finance, scenarios, calibration, triggers, snapshots/diff/attribution, next action. Fixtures and property tests.
- **Accept:** all unit, fixture, and property tests pass; core has zero imports from React/DOM/data layers (enforced by an ESLint import rule).

### Phase 2 — Persistence
- Dexie schema v1, repositories, validation on write, export/import, persistent-storage request.
- **Accept:** round-trip property test passes; invalid imports rejected with no partial writes.

### Phase 3 — Harness and question engine
- Sessions, hooks, context assembler, stuck detector, scaffold levels, question bank, gap detector, answer application.
- **Accept:** unit tests for each; a scripted test drives the full charter sequence C1–C8 to a valid model.

### Phase 4 — First run and Plan mode
- FirstRun flow, Plan list view, graph view, gaps panel, charter editor, premortem, money editors.
- **Accept:** a new user reaches Today with one task in under 5 minutes (manual check + e2e); cycles are blocked with a clear message naming the tasks; critical path highlights in graph.

### Phase 5 — Execute mode
- Today screen, context card, pre/post-task hooks, optional timer, evidence, handoff note, resume flow.
- **Accept:** complete a task with actual time/cost/evidence in ≤ 3 taps after Start (excluding typing); handoff note appears first after a simulated 3-day gap.

### Phase 6 — Forecast
- Scenario chart, predict-then-reveal, "Why this number?" traces, snapshots, "What changed," original vs current, influential assumptions, disclaimer.
- **Accept:** every displayed forecast number opens a trace; diff shows input changes, output deltas, and attribution.

### Phase 7 — Review
- Calibration summary and acceptance, assumption check, triggers, reforecast, memory log, forecasting-skill trend.
- **Accept:** accepting a calibration multiplier changes remaining-task schedule only; reforecast creates a snapshot and diff.

### Phase 8 — Hardening
- PWA offline, accessibility pass, dark mode, demo mode, storage status and export reminders, `.ics` export for task intentions (a user can add "when/where" commitments to their own calendar), performance (graph of 300 tasks stays interactive).
- **Accept:** Playwright offline test passes; Lighthouse accessibility ≥ 95; no console errors.

---

## 16. Explicitly out of scope (MVP)

LLMs of any kind; backend or accounts; sync across devices (export/import only); bank/brokerage connections; investment recommendations; tax logic; collaboration or sharing; notifications/web push; multi-goal resource allocation; subscriptions or payments; analytics/telemetry; gamification; non-finish-to-start dependency types; currency conversion.

---

## 17. Post-MVP extensions

### 17.1 Optional model-backed questioner

Behind an interface, off by default:

```ts
interface Questioner {
  nextQuestions(ctx: QuestionContext): Promise<QuestionCandidate[]>;
}
// QuestionCandidate = { gapId?: string; questionText: string; target: WriteTarget }
```

Default implementation is the rule-based gap detector. A model-backed implementation (in-browser runtime or a browser's built-in model API, whichever is viable at the time) may only **rephrase or target questions using the user's own words** (e.g. "You wrote 'get customers.' Who specifically is the first one, and how would you reach them?"). Its output schema contains no task, estimate, or money fields, so it structurally cannot generate plan content. It may also convert the user's free-text answers into structured fields, subject to the same validation and user confirmation.

### 17.2 Native iPhone app

Two paths, both enabled by the pure core:

- **Wrap**: package the web app with Capacitor for the App Store, adding native notifications and file-backed storage.
- **Port**: reimplement `src/core` in Swift (SwiftData, SwiftUI, Swift Charts), using `fixtures/` as the conformance suite so both implementations produce identical results.

Interim: iOS users can install the PWA to the home screen.

### 17.3 Later product features

Multiple goals competing for capacity and money; what-if sliders (e.g. hours/week) with instant recompute; opportunity-cost view; life-area goal map; App Intents / Siri actions in the native app.

---

## 18. North-star metrics (for the owner's own evaluation; nothing is collected)

Since there's no telemetry, these are evaluated through user interviews and opt-in exports:

- Share of created plans with ≥ 1 executed task in week 1 and week 4
- Median days between Review sessions
- Trend in the user's own forecasting error (predicted vs realized)
- Share of tasks completed with evidence
- Share of reforecast prompts acted on

The target behavior: **model → act → record reality → update model → act again.**

---

## 19. CLAUDE.md starter

```markdown
# GoalGraph — instructions for Claude Code

Spec: docs/SPEC.md (source of truth). Log decisions in docs/DECISIONS.md.

## Commands
- npm run dev        # local dev server
- npm test           # vitest (unit, fixtures, property)
- npm run test:e2e   # playwright
- npm run lint
- npm run build      # production build to dist/

## Hard rules
- Build phases in order (SPEC §15). Don't start a phase until the prior phase's acceptance criteria pass.
- src/core is pure TS: no React, DOM, Dexie, fetch, Date.now(), or Math.random(). Inject Clock and IdGen.
- Money is integer cents. Round half away from zero at every step.
- Engines are deterministic; follow the tie-break orders in SPEC §9 exactly.
- The app never generates tasks, estimates, or amounts for the user. It asks questions.
- No LLMs, no backend, no analytics, no runtime network calls.
- Never persist a model that fails validation.
- Write core tests (incl. fixtures in /fixtures) before building UI that depends on an engine.
- Ask before adding a dependency not in SPEC §12.3.
- Hash routing; Vite base path from env for GitHub Pages.
- UI copy: questions, not commands. No "you should." Financial screens show the disclaimer.
```

---

## 20. Definition of done (MVP)

A new user, with no account, on an iPhone browser, can:

1. State a goal in one sentence and complete the charter in under 5 minutes.
2. Build milestones and tasks by answering gap questions and editing freely.
3. See the dependency graph and critical path.
4. Enter estimate ranges, costs, capacity, and financial starting points.
5. Guess their completion date, then see three deterministic scenarios.
6. Execute tasks with definition of done, intention, actuals, and evidence.
7. Leave and return days later to their own handoff note.
8. Run a weekly review, see their calibration, and accept or reject an adjustment.
9. Reforecast and see exactly what changed and why.
10. Export their data, and use the app fully offline.

And throughout, every task, estimate, and number in their plan came from their own head.

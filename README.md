# GoalGraph

**A harness for the human brain.** Turn a large, ambiguous goal into a living model of your own work: a
dependency graph of *your* tasks, *your* estimates, a deterministic forecast, and a feedback loop that
updates as reality arrives.

Most AI products think for you. GoalGraph makes you a sharper thinker about your own life. It never writes
your plan. It asks precise questions, finds gaps, keeps planning and doing apart, records your predictions
against what actually happened, and does all the arithmetic.

**Live:** https://emu-commits.github.io/brain-harness/

- No account, no server, no analytics. Everything stays in your browser (IndexedDB). Export any time.
- No LLM. The "intelligence" is a deterministic question engine plus deterministic calculation engines.
- Every forecast number is explainable: tap it to see the inputs, ranges and formula.

## What's here (Phases 0–5 of [the spec](docs/SPEC.md))

- **First run** in under five minutes: goal → proof → date → why → inner obstacle → if-then plan →
  backward-chained milestone → one small first action with when, where and done-when.
- **Today** (Execute): charter line, last handoff note, one suggested next action with its context card,
  pre-task hook → timer → post-task hook (actual time, cost, evidence, surprise), stuck-task cards, inbox
  capture, base forecast with its range.
- **Plan**: gap questions one at a time with fading scaffolding, list view, dependency graph (dagre + SVG,
  pan/zoom/pinch, focus mode, collapsible milestones, critical path), charter and premortem, commitments,
  and money (accounts, cash flows, revenue streams).
- **Sessions** with deliberate friction: Plan, Execute and Review are separate, and ending one runs its hook
  (a handoff note or a memory entry). After three or more days away, your handoff note comes first.
- **Core engines** (pure TypeScript, fully tested): graph and cycles, critical path, a capacity-based
  scheduler, monthly finance projection, three scenarios from your own ranges, calibration, reforecast
  triggers, snapshots with diff and attribution, and next-action selection.

Next: the Forecast screen (charts, predict-then-reveal, "What changed"), Review (calibration, assumptions,
reforecast), and hardening (offline PWA, accessibility audit, `.ics` export).

## Develop

```sh
npm install
npm run dev          # http://localhost:5173/brain-harness/
npm test             # unit + fixture + property tests (vitest, fast-check)
npm run test:e2e     # Playwright on iPhone + desktop profiles
npm run lint
npm run build
```

## Architecture

```
src/core/   pure TS domain (no React/DOM/storage/clock): model, validation, engines, harness, questions
src/data/   Dexie storage, migrations, export/import, demo data
src/app/    React UI
fixtures/   language-agnostic engine fixtures: the future Swift conformance suite
```

See [docs/DECISIONS.md](docs/DECISIONS.md) for implementation decisions and [CLAUDE.md](CLAUDE.md) for
contributor rules.

*Financial figures are hypothetical models of the assumptions you enter, not predictions and not financial advice.*

MIT licensed.

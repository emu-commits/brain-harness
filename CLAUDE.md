# GoalGraph — instructions for Claude Code

Spec: docs/SPEC.md (source of truth). Log decisions in docs/DECISIONS.md.

## Commands
- npm run dev        # local dev server
- npm test           # vitest (unit, fixtures, property)
- npm run test:e2e   # playwright (set PW_CHROMIUM=/path/to/chromium to use a preinstalled browser)
- npm run lint
- npm run build      # production build to dist/

## Hard rules
- Build phases in order (SPEC §15). Don't start a phase until the prior phase's acceptance criteria pass.
- src/core is pure TS: no React, DOM, Dexie, fetch, Date.now(), or Math.random(). Inject Clock and IdGen.
  (Enforced by ESLint rules in eslint.config.js.)
- Money is integer cents. Round half away from zero at every step.
- Engines are deterministic; follow the tie-break orders in SPEC §9 exactly.
- The app never generates tasks, estimates, or amounts for the user. It asks questions.
- No LLMs, no backend, no analytics, no runtime network calls.
- Never persist a model that fails validation. All writes go through `commit()` in src/app/store.tsx,
  which validates, checks session-mode permissions, then persists atomically.
- Write core tests (incl. fixtures in /fixtures) before building UI that depends on an engine.
- Ask before adding a dependency not in SPEC §12.3.
- Hash routing; Vite base path from env (BASE_PATH) for GitHub Pages.
- UI copy: questions, not commands. No "you should." Financial screens show the disclaimer.

## Status
Phases 0–5 are built. Next: Phase 6 (Forecast screen), 7 (Review), 8 (Hardening: PWA, a11y audit, .ics).
The engines those phases need (scenarios, snapshots/diff/attribution, calibration, triggers) already exist
in src/core/engines with tests.

## Layout
- src/core/model — types, factories, selectors
- src/core/validation — invariants (SPEC §8.1)
- src/core/engines — graph, cpm, scheduler, finance, scenarios, calibration, triggers, snapshots, nextAction
- src/core/harness — sessions (mode guard), hooks, context assembler, stuck detector, scaffold levels
- src/core/questions — bank (question text as data), examples, gaps, apply
- src/data — Storage port, Dexie implementation, migrations, export/import, demo data
- src/app — React UI (store, session switching, screens)
- fixtures/ — language-agnostic engine fixtures (cross-language conformance suite)

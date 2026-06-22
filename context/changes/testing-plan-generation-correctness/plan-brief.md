# Plan-generation correctness & boundaries — Plan Brief

> Full plan: `context/changes/testing-plan-generation-correctness/plan.md`
> Research: `context/changes/testing-plan-generation-correctness/research.md`

## What & Why

Rollout Phase 1 of the test plan, closing **Risk #1**: plan generation mishandling
degenerate/malformed input. Research found the wedge calc is already pure, defensive, and
tested against an independent oracle — so this phase isn't fixing a crash, it's locking the
calc's real defensive behavior and the untested explanatory/render states with cheap-layer
regression tests, every expectation hand-derived (never copied from the implementation).

## Starting Point

`computePlanTable` (`src/lib/plan-table.ts`) sorts stations, drops out-of-range ones, skips
zero-length legs, and clamps elevation — it cannot emit a negative segment. `plan-table.test.ts`
already covers the worked reference, zero stations (calc), missing params, rest-over-budget,
and GPX derivations with hand-derived oracles. Untested: out-of-order sort (e2e-only today),
duplicate/beyond-total/non-monotonic-elevation cases, invalid start_time, and the entire
render layer (`ok:false` explanatory state + zero-station one-row table).

## Desired End State

`npx vitest run tests/unit` passes with 6 new calc cases and 3 new render cases; the
out-of-order signal moves from expensive e2e to cheap unit; the `ok:false` explanatory state
(PRD US-01 AC) and zero-station render are locked; §6.1 cookbook documents how to add calc and
render-state tests; three deferred items are recorded. No new deps, no production-code change.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Bad-data handling (cumulative > total, Infinity) | Test-only, document the silent drop as intended | Keeps this a pure test rollout with no production risk; rejection deferred | Research + Plan |
| Optional cases | Include U6 (Infinity → no NaN) and a clamp-UX follow-up note | Both cheap; U6 locks a real Zod v4 edge, the note captures a product question | Plan |
| Vitest CI gate | Document as a finding, defer YAML wiring | Lesson boundary forbids CI config here; §5 gate stays `planned` | Plan |
| Phasing | Two phases (calc / render) + cookbook step each | Two distinct seams/files, each independently verifiable | Plan |
| Layer | Unit + `react-dom/server` render only | Research: e2e additions would be the "promote because it feels safer" anti-pattern | Research |

## Scope

**In scope:** 6 calc-boundary cases (U1–U6) in `plan-table.test.ts`; 3 render-state cases
(R1–R3) in `plan-table-render.test.ts`; §6.1 cookbook updates; recording 3 deferred items.

**Out of scope:** boundary rejection / DB CHECK (separate change); CI YAML wiring; any e2e
additions; new dependencies; editing §2 risk wording (orchestrator's backport job).

## Architecture / Approach

Extend two existing test files using their established patterns: hand-derived oracle comments
for the pure calc, and `renderToStaticMarkup` + `data-testid` extraction for the render states
(no jsdom/RTL/new deps). Each phase ends by updating the §6.1 cookbook so it becomes the
canonical "how to add a test for X here" reference.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Calc boundary tests (U1–U6) | Sort, duplicate, beyond-total, clamp, start_time, Infinity locked | Oracle slip — copying expected values from calc output |
| 2. Render-state tests (R1–R3) + deferred items | Explanatory state + zero-station render locked; cookbook + deferred items | Missing the absence-assertion (no plan-table on error) |

**Prerequisites:** local Vitest (`^4.1.9`) runs; no Supabase/DB needed for this phase.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The clamp-to-0 of non-monotonic elevation and the Infinity drop are assumed to be *intended*
  behavior (locked by U4/U6); a UX decision to surface a warning is deferred.
- Vitest is not confirmed in CI, so these tests gate locally only until a later change wires it.

## Success Criteria (Summary)

- `npx vitest run tests/unit` green with 9 new independent-oracle cases.
- The `ok:false` explanatory state and zero-station one-row render are covered.
- §6.1 cookbook filled in; CI / clamp-UX / validation-tightening items recorded for follow-up.

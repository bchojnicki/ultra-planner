# Plan-generation correctness & boundaries — Implementation Plan

## Overview

Close the cheap-layer test gaps for **Risk #1** of `context/foundation/test-plan.md`
(rollout Phase 1). The wedge calc (`computePlanTable`) is already pure, defensive, and
tested against an independent oracle — research proved the "negative segment / crash"
framing of the risk is overstated. The genuine, fundable gaps are narrow and all sit at the
cheapest layer: six calc-boundary cases (Vitest unit) and three render-state cases
(`react-dom/server`). This plan adds those tests, every expected value hand-derived from the
PRD Business Logic (never from the implementation under test), with **no new dependencies and
no production-code change**.

## Current State Analysis

- **The calc is the validation backstop.** With no DB CHECK constraints and only per-field
  Zod (`nonNegative = z.number().min(0)`, no cross-field rule), correctness for degenerate
  input lives entirely in `computePlanTable` (`src/lib/plan-table.ts`): it sorts stations by
  cumulative distance, keeps only `0 < cumulative < finish`, skips non-positive-length legs
  (`rawDistance > 0`), and clamps per-segment elevation with `Math.max(0, …)`. It cannot emit
  a negative segment.
- **Stations are an unordered, owner-scoped set, not a list.** There is no stored sequence to
  "reverse"; entry order is derived at compute time (PRD US-04 AC). The risk's "distances go
  backwards" branch does not exist as written.
- **Existing oracle quality is good.** `tests/unit/plan-table.test.ts` hand-derives every
  expected number from the PRD Business Logic (header lines 1–3) — no oracle-problem
  violation. It already covers the worked reference, zero stations (calc), `missing_params`,
  `rest_exceeds_budget`, station-at-finish, and the GPX loss/calibration derivations.
- **The render branch is untested.** `PlanTable.tsx:171-180` renders the `ok:false`
  explanatory state (amber `data-testid="plan-table-error"`); the zero-station valid state
  renders a one-row `"Start → Finish"` table. Neither has any coverage.
- **The seam to reuse exists.** `tests/unit/plan-table-render.test.ts` already renders
  `PlanTable` via `renderToStaticMarkup` in the node env with **no jsdom/RTL/new deps** — it
  currently only covers the gear-footer total.

### Key Discoveries

- Calc guards & derivation: `src/lib/plan-table.ts:40-46` (missing_params), `:57-60` (filter +
  sort), `:63-72` (rest_exceeds_budget), `:96-116` (segment build; `rawDistance > 0` skip;
  `Math.max(0, …)` clamp), `:120-123` (invalid start_time).
- Independent-oracle calc tests to extend: `tests/unit/plan-table.test.ts:1-3,53-214`.
- Render seam to extend: `tests/unit/plan-table-render.test.ts:6-9,80-117`.
- Render branch under test: `src/components/plans/PlanTable.tsx:171-180`.
- Thin validation boundary (deliberate): `src/lib/schemas.ts:6,26-55` (no cross-field rule);
  Zod v4 `min(0)` accepts `+Infinity`; no DB CHECK in
  `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql`.

## Desired End State

`npx vitest run tests/unit` passes with six new calc-boundary cases and three new
render-state cases, each asserting an independently-derived expected value. The previously
untested `ok:false` explanatory state and zero-station one-row render are locked; the
out-of-order sort signal is pulled down from the expensive e2e layer to the cheap unit layer;
the calc's silent-drop / clamp behaviors are asserted as **intended**. `test-plan.md` §6.1 is
filled in with the canonical "how to add a calc / render-state test" pattern, and the three
deferred items (CI wiring, clamp UX, validation tightening) are recorded so they are not lost.

Verify: `npx vitest run tests/unit` is green; `npm run lint` and type-check pass; §6.1 no
longer reads "TBD"; the three deferred items appear in this change folder / test-plan.

## What We're NOT Doing

- **No boundary rejection of bad data.** We assert the calc's current silent-drop of
  `cumulative > total` and `Infinity` as intended behavior. Hard rejection (cross-field Zod /
  DB CHECK) is a separate change — recorded as a deferred follow-up, not implemented here.
- **No CI YAML.** Wiring Vitest into `ci.yml` is owned by another lesson/module; we only
  record it as a Phase-1 finding so the §5 gate can move from `planned` to `required` later.
- **No e2e additions.** The e2e suite already covers happy generate + out-of-order sort at the
  expensive layer; pushing boundary cases to e2e is the "promote to e2e because it feels
  safer" anti-pattern the test plan forbids.
- **No new dependencies, no production-code change, no jsdom/RTL.** Both files use existing
  patterns (hand-derived oracle; `renderToStaticMarkup`).
- **Not editing §2 risk wording.** Research's risk-reframe backport is the `/10x-test-plan`
  orchestrator's job; this plan only flags it (see References).

## Implementation Approach

Two phases mapped to the two distinct seams/files, each independently runnable and verifiable,
each closing with the relevant §6.1 cookbook update. Phase 1 extends the pure-calc test file;
Phase 2 extends the render test file and records the deferred items. Expected values are
hand-computed from the PRD Business Logic in the same style as the existing file's header
comments — the new cases must never copy numbers from `computePlanTable`'s output.

## Critical Implementation Details

- **Oracle discipline is the whole point.** Every numeric expectation must be derivable on
  paper from the PRD Business Logic and written as a comment next to the assertion (as the
  existing tests do, e.g. `// 590·50/120`). An expectation read back from the calc green-lights
  current bugs (§1 rule 4).
- **U4 and U6 lock *current* behavior as intended.** The non-monotonic-elevation clamp-to-0
  and the `Infinity` drop are asserted as the desired contract, not flagged as failures — any
  future change to those branches must consciously update these tests.

## Phase 1: Calc boundary tests (U1–U6)

### Overview

Extend `tests/unit/plan-table.test.ts` with six boundary cases for degenerate aid-station sets
and malformed params, then fill in the §6.1 calc cookbook entry.

### Changes Required:

#### 1. Calc boundary cases

**File**: `tests/unit/plan-table.test.ts`

**Intent**: Add six `it(...)` cases (reusing the existing `makePlan` / `makeStation`
factories) inside the `edge cases` describe block, each with a hand-derived oracle comment.
These close the calc gaps research enumerated and pull the out-of-order sort down from e2e.

**Contract**: Each case calls `computePlanTable(plan, stations)` and asserts against
independently-derived values:
- **U1 — out-of-order set.** ≥3 stations supplied shuffled → `result.rows` is sorted ascending
  by cumulative distance; labels are `AS1..ASn` in ascending order; per-segment distances match
  the hand-derived legs. (Oracle: PRD US-04 AC "sorted regardless of entry order".)
- **U2 — duplicate cumulative distance.** Two stations at the same cumulative distance → the
  zero-length leg is skipped (no phantom row), surviving segment distances and total rest are
  correct. (Oracle: PRD Business Logic; mirrors the existing station-at-finish case.)
- **U3 — station beyond total.** A station with `cumulative_distance_km > total_distance_km` →
  dropped; the remaining table is identical to the table without it. (Extends the at-finish
  drop to beyond-finish.)
- **U4 — non-monotonic cumulative elevation.** Sorted stations whose cumulative elevation gain
  decreases between points → the affected segment gain is clamped to 0 (never negative), and
  segment weight ≥ segment distance. **Asserted as intended behavior.**
- **U5 — invalid start_time.** A plan with an unparseable `start_time` → `ok:false`,
  `error === "missing_params"`. (Oracle: `plan-table.ts:120-123`.)
- **U6 — Infinity cumulative distance.** A station with `cumulative_distance_km = Infinity` →
  dropped by the `< finish` filter; no output cell (distances, times, nutrition, arrivals) is
  `NaN`. **Defense-in-depth; asserted as intended.**

### Success Criteria:

#### Automated Verification:

- New calc tests pass: `npx vitest run tests/unit/plan-table.test.ts`
- Full unit suite passes: `npx vitest run tests/unit`
- Lint passes: `npm run lint`
- Type-check passes (via lint's type-checked rules / `npx astro sync` if needed)

#### Manual Verification:

- Each new case carries a hand-derived oracle comment; no expected value is copied from calc output
- U4 and U6 are written as "lock current behavior", not as bug reports
- §6.1 cookbook entry updated with the calc-boundary pattern (location, reference test, run command)

**Implementation Note**: After Phase 1's automated verification passes, pause for human
confirmation that the new cases read as independent-oracle assertions before starting Phase 2.

#### 2. Cookbook update (§6.1 calc)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.1 "TBD — Phase 1 will record…" placeholder with the concrete
calc-boundary pattern.

**Contract**: §6.1 names the location (`tests/unit/<module>.test.ts`, node env), the reference
test (`tests/unit/plan-table.test.ts`), the independent-oracle rule (hand-derive from PRD
Business Logic, comment the derivation), and the run command (`npx vitest run tests/unit`).

---

## Phase 2: Render-state tests (R1–R3) + deferred items

### Overview

Extend `tests/unit/plan-table-render.test.ts` with the three explanatory/zero-station render
cases, fill in the §6.1 render note, and record the three deferred items.

### Changes Required:

#### 1. Render-state cases

**File**: `tests/unit/plan-table-render.test.ts`

**Intent**: Add a describe block that renders `PlanTable` via the existing
`renderToStaticMarkup` helper for the error and zero-station states, reusing the file's
`result()` factory shape (adapted to `ok:false` payloads where needed).

**Contract**: Each case renders `PlanTable` and asserts on the static markup:
- **R1 — `ok:false` missing_params.** Markup contains `data-testid="plan-table-error"` with the
  error message, and does **not** contain `data-testid="plan-table"`. (Oracle: PRD US-01 AC
  explanatory state; `PlanTable.tsx:171-180`.)
- **R2 — `ok:false` rest_exceeds_budget.** Markup renders the rest-exceeds message in the error
  box.
- **R3 — zero-station valid plan.** Markup contains exactly one `data-testid="plan-row"`
  labelled `"Start → Finish"` plus the totals row (proves "not empty/broken").

#### 2. Cookbook update (§6.1 render note)

**File**: `context/foundation/test-plan.md`

**Intent**: Add a render-state note under §6.1 (or §6.6 per-phase note) capturing the
`react-dom/server` pattern for asserting `ok:false` / zero-station states with no new deps.

**Contract**: Names `tests/unit/plan-table-render.test.ts` as the reference, the
`renderToStaticMarkup` + `data-testid` regex extraction technique, and the run command.

#### 3. Record deferred items

**File**: `context/changes/testing-plan-generation-correctness/change.md` (Notes) and/or
`context/foundation/test-plan.md`

**Intent**: Persist the three decisions so they are not lost, without acting on them.

**Contract**: Record (a) **Vitest-in-CI finding** — `ci.yml` is lint+build only; the §5 gate
"unit+integration required after Phase 1" stays `planned` until a future CI change wires it;
(b) **non-monotonic-clamp UX question** — is silent clamp-to-0 the intended product behavior
or should it surface a warning? (locked by U4 for now); (c) **validation-tightening
follow-up** — a future `/10x-new` change may reject `cumulative > total` / `Infinity` at the
API/DB boundary.

### Success Criteria:

#### Automated Verification:

- New render tests pass: `npx vitest run tests/unit/plan-table-render.test.ts`
- Full unit suite passes: `npx vitest run tests/unit`
- Lint passes: `npm run lint`

#### Manual Verification:

- R1 asserts both the presence of the error testid and the **absence** of the table testid
- R3 asserts exactly one plan-row (not ≥1), proving the zero-station state is a valid one-row table
- §6.1 render note added; three deferred items recorded in the change folder / test-plan
- No new dependency added to `package.json`

**Implementation Note**: After Phase 2's automated verification passes, confirm the §3 Phase-1
row in `test-plan.md` can be marked `complete` and the deferred items are captured.

---

## Testing Strategy

### Unit Tests:

- Calc boundary (U1–U6) and render-state (R1–R3) as above — this phase *is* the test work.
- All expectations hand-derived from PRD Business Logic; U4/U6 lock current behavior.

### Integration Tests:

- None. Research confirmed the rendered explanatory state is a unit render test
  (`react-dom/server`), not integration; no DB interaction is needed for Risk #1.

### Manual Testing Steps:

1. Run `npx vitest run tests/unit` — confirm 9 new cases pass.
2. Spot-check one new oracle comment by re-deriving the number on paper from the PRD.
3. Confirm `git diff package.json` is empty (no new deps).

## Performance Considerations

None — pure unit/render tests, negligible runtime.

## Migration Notes

None — no schema or data change.

## References

- Research: `context/changes/testing-plan-generation-correctness/research.md` (test targets
  U1–U6 / R1–R3, oracle quality table, deferred decisions, and the §2 risk-reframe backport
  for `/10x-test-plan` — not done here).
- Test plan: `context/foundation/test-plan.md` (§1 principles, §2 Risk #1, §3 Phase 1, §6.1
  cookbook).
- Calc under test: `src/lib/plan-table.ts:40-123`; render branch:
  `src/components/plans/PlanTable.tsx:171-180`.
- Test seams to extend: `tests/unit/plan-table.test.ts`, `tests/unit/plan-table-render.test.ts`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Calc boundary tests (U1–U6)

#### Automated

- [x] 1.1 New calc tests pass: `npx vitest run tests/unit/plan-table.test.ts` — 3cca68f
- [x] 1.2 Full unit suite passes: `npx vitest run tests/unit` — 3cca68f
- [x] 1.3 Lint passes: `npm run lint` — 3cca68f
- [x] 1.4 Type-check passes — 3cca68f

#### Manual

- [x] 1.5 Each new case carries a hand-derived oracle comment; no expected value copied from calc output — 3cca68f
- [x] 1.6 U4 and U6 written as "lock current behavior", not bug reports — 3cca68f
- [x] 1.7 §6.1 cookbook calc-boundary entry updated — 3cca68f

### Phase 2: Render-state tests (R1–R3) + deferred items

#### Automated

- [x] 2.1 New render tests pass: `npx vitest run tests/unit/plan-table-render.test.ts`
- [x] 2.2 Full unit suite passes: `npx vitest run tests/unit`
- [x] 2.3 Lint passes: `npm run lint`

#### Manual

- [x] 2.4 R1 asserts presence of error testid and absence of table testid
- [x] 2.5 R3 asserts exactly one plan-row (valid one-row table)
- [x] 2.6 §6.1 render note added; three deferred items recorded
- [x] 2.7 No new dependency added to `package.json`

---
date: 2026-06-22T00:00:00Z
researcher: Claude (10x-research)
git_commit: 609f5cd
branch: main
repository: ultra-planner
topic: "Ground rollout Phase 1 of test-plan.md — Risk #1 (plan-generation degenerate/malformed input)"
tags: [research, codebase, plan-table, calc, validation, test-plan, risk-1]
status: complete
last_updated: 2026-06-22
last_updated_by: Claude (10x-research)
---

# Research: Plan-generation correctness & boundaries (Risk #1)

**Date**: 2026-06-22
**Researcher**: Claude (10x-research)
**Git Commit**: 609f5cd
**Branch**: main
**Repository**: ultra-planner

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md`, Risk #1 — plan generation
mishandling degenerate/malformed input (zero stations, single station, cumulative
distances that decrease). Verify (not blindly accept) the response guidance: prove zero
stations renders the explanatory state, a single station has defined behavior, and a
decreasing cumulative distance is rejected or surfaced (never a silent negative segment).
Challenge "happy path ⇒ boundaries" and "client validation is enough." Check whether the
existing tests assert against an independent oracle or their own output (oracle problem).
Identify the cheapest useful layer and flag speculative risk or misleading hot-spot evidence.

## Summary

The wedge calc is **already well-built and well-tested with an independent oracle** — the
risk's framing overstates the failure. The genuine, fundable gaps are narrower and all sit
at the **cheapest layer (Vitest unit)**:

1. **The calc is pure and defensive.** `computePlanTable` (`src/lib/plan-table.ts`) sorts
   aid stations by cumulative distance (line 60) and skips non-positive-length legs
   (line 101). Its unit test (`tests/unit/plan-table.test.ts`) hand-derives every expected
   number from the PRD Business Logic — **no oracle-problem violation**. Zero-station,
   single-station, missing-params, rest-exceeds-budget and station-at-finish cases are
   already covered there.

2. **"Cumulative distances that decrease (go backwards)" is not a real failure mode in this
   architecture.** Aid stations are independent owner-scoped rows, not an ordered list —
   there is no sequence to reverse. Entry order is handled by the calc's sort (this is the
   PRD US-04 AC: "sorted by cumulative distance regardless of entry order"), and a negative
   cumulative distance is rejected by Zod at the API. **This part of Risk #1 should be
   reframed** (see Challenger Findings).

3. **"Client validation is enough" is the right thing to challenge — and it fails.** There
   is essentially **no server-side cross-field validation and no DB CHECK constraints**.
   The Zod schemas only enforce `>= 0` (and even accept `Infinity`). The pure calc is the
   de-facto guard. That makes the calc's defensive behavior load-bearing and worth locking
   down with regression tests.

4. **The PRD US-01 "explanatory state" maps to the `ok:false` render branch, which is
   untested.** Zero stations is *not* an empty/broken state — it's a valid one-row
   "Start → Finish" table. The "explanatory state rather than empty or broken" the PRD
   requires is the amber `data-testid="plan-table-error"` box shown on `missing_params` /
   `rest_exceeds_budget` (`PlanTable.tsx:171-180`). The render layer's handling of these
   states has **zero coverage**.

**Cheapest useful layer:** extend `tests/unit/plan-table.test.ts` (pure calc) and
`tests/unit/plan-table-render.test.ts` (render via `react-dom/server`, no jsdom/RTL/new
deps). Do **not** add e2e for these — the e2e suite already covers the happy generate +
out-of-order sort at the expensive layer; pushing boundary cases to e2e is the
"promote to e2e because it feels safer" anti-pattern the test plan warns against.

## Detailed Findings

### The calc — `src/lib/plan-table.ts`

- **Required-param guard** ([plan-table.ts:40-46](src/lib/plan-table.ts#L40)): returns
  `{ ok:false, error:"missing_params" }` when `total_distance_km <= 0 ||
  total_elevation_gain_m <= 0 || total_expected_minutes <= 0`.
- **Invalid start_time guard** ([plan-table.ts:120-123](src/lib/plan-table.ts#L120)):
  `Number.isNaN(startMs)` → `missing_params` with a start-time message.
- **Station filter + sort** ([plan-table.ts:57-60](src/lib/plan-table.ts#L57)): keeps only
  `0 < cumulative_distance_km < distCal.finish`, then **sorts ascending**. Stations beyond
  the finish anchor are silently dropped; entry order is irrelevant.
- **Rest-budget guard** ([plan-table.ts:63-72](src/lib/plan-table.ts#L63)):
  `moving = total_expected - Σ rest`; `<= 0` → `rest_exceeds_budget`.
- **Segment building** ([plan-table.ts:96-116](src/lib/plan-table.ts#L96)): pairs
  consecutive points; `if (rawDistance > 0)` **skips zero/negative-length legs** (duplicate
  or coincident cumulative distances). Per-segment gain/loss use
  `Math.max(0, pt - prev)` (lines 103-104) → **a non-monotonic cumulative elevation is
  clamped to 0, never negative** (currently silent, defensible behavior).

Net: the calc cannot emit a negative segment distance. The "backwards distance → negative
segment / crash" branch of the risk does not exist.

### Validation boundary — thin by design

- **Zod schemas** (`src/lib/schemas.ts`): `nonNegative = z.number().min(0)`
  ([schemas.ts:6](src/lib/schemas.ts#L6)). `aidStationCreateSchema`
  ([schemas.ts:26-38](src/lib/schemas.ts#L26)) and `aidStationUpdateSchema`
  ([schemas.ts:43-55](src/lib/schemas.ts#L43)) validate each field independently. **No
  cross-field rule** (no `cumulative_distance_km < total_distance_km`, no monotonicity).
- **Zod v4 edge behavior** (zod ^4.4.3): `z.number()` **rejects NaN** (invalid_type) but
  `z.number().min(0)` **accepts `+Infinity`** (`Infinity >= 0` is true). A persisted
  `Infinity` cumulative distance is later dropped by the `< distCal.finish` filter, so no
  NaN propagates — but it is a defense-in-depth gap, not a crash.
- **DB**: migration `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql`
  and `20260617120000_gpx_import_columns.sql` declare the numeric columns `NOT NULL` with
  defaults but **zero CHECK constraints** — no value or ordering enforcement.
- **API routes** apply only the Zod schema, then insert: `aid-stations.ts` create
  (`src/pages/api/plans/[id]/aid-stations.ts`), `aid-stations/[id].ts` update,
  `plans/[id].ts` update. Ownership is enforced via RLS (42501 → 403, PGRST116 → 404).
- **Consequence**: a station with `cumulative_distance > total`, or `Infinity`, **persists**
  and is only absorbed by the calc at render time. Whether to *reject* these at the boundary
  (a code change) vs. *document the drop* (a test-only assertion) is a decision for
  `/10x-plan` — Phase 1 is a test rollout, so the default is to assert current behavior, and
  flag the validation-tightening question as a separate change if the team wants rejection.

### Where the calc runs + the render branch — `src/components/plans/PlanTable.tsx`

- **Call sites**: `PlanEditor.tsx:49` (`useMemo`, reactive on every param/station edit,
  client island), `PlanEditor.tsx:123` (ad-hoc, to detect stale gear-segment indexes),
  `plans/[id].astro:26` (server-side, once, read-only view). There is **no explicit
  "generate" button** — the table is derived live.
- **Error/explanatory state** ([PlanTable.tsx:171-180](src/components/plans/PlanTable.tsx#L171)):
  `if (!result.ok)` renders only `result.message` in an amber box
  `data-testid="plan-table-error"`; the table is not rendered.
- **Zero-station valid plan**: one row labelled `"Start → Finish"`, `ok:true`. Renders the
  full one-row table + totals. Useful test handles: `data-testid="plan-table"`,
  `plan-row`, `plan-totals`.

### Existing coverage (and its oracle quality)

| Case | Covered? | Where | Oracle |
|---|---|---|---|
| Worked reference (1 station → 2 segments, distance/weight/moving/nutrition/arrival) | ✅ | `tests/unit/plan-table.test.ts:53-97` | **Independent** (hand-derived, header lines 1-3) |
| Zero stations → single Start→Finish row (calc) | ✅ | `plan-table.test.ts:100-110` | Independent |
| missing_params (distance/gain/expected = 0) | ✅ | `plan-table.test.ts:122-129` | Independent |
| rest_exceeds_budget | ✅ | `plan-table.test.ts:131-136` | Independent |
| Station exactly at finish dropped | ✅ | `plan-table.test.ts:138-145` | Independent |
| Elevation-loss derivation + calibration (GPX) | ✅ | `plan-table.test.ts:148-214` | Independent |
| Out-of-order multi-station sort | ⚠️ e2e only | `tests/plans-setup.spec.ts:48-66` | Behavioral (expensive layer) |
| Happy generate renders correct numbers | ✅ e2e | `plans-setup.spec.ts:68-97` | **Independent** ("2083 ml" hand-computed) |
| Duplicate cumulative distance (zero-length leg) | ❌ | — | — |
| Station beyond total distance (cumulative > total) | ❌ | — | — |
| Non-monotonic cumulative elevation → clamp to 0 | ❌ | — | — |
| Invalid start_time → missing_params | ❌ | — | — |
| **Render of `ok:false` (explanatory state, US-01 AC)** | ❌ | — | — |
| **Render of zero-station one-row table** | ❌ | — | — |
| Schema rejects negatives/unknown keys | ✅ | `plans-flow.test.ts`, `aid-station-edit.test.ts` | Independent |

`tests/unit/plan-table-render.test.ts` exists but **only** covers the gear footer total — it
proves the `renderToStaticMarkup` pattern works in the node env with no extra deps, which is
exactly the seam to reuse for the missing render-state tests.

## Cheapest-layer test targets for `/10x-plan`

Extend `tests/unit/plan-table.test.ts` (pure calc; oracle = PRD Business Logic, hand-computed):
- **U1** Out-of-order set (≥3 shuffled stations) → sorted; labels AS1..ASn ascending; per-segment distances correct. (Pulls the e2e-only sort signal down to the cheap layer; oracle: PRD US-04 AC.)
- **U2** Two stations at the same cumulative distance → zero-length leg skipped, no phantom row, surviving segments + rest correct.
- **U3** Station with `cumulative_distance > total` → dropped; remaining table correct (extends the at-finish case to beyond-finish).
- **U4** Non-monotonic cumulative elevation gain (decreases between sorted stations) → segment gain clamped to 0, weight ≥ distance, never negative. **Assert the currently-silent behavior as intended.**
- **U5** Invalid `start_time` → `missing_params`.
- **U6 (optional, defense-in-depth)** `Infinity` cumulative distance → dropped, no NaN in any output cell.

Extend `tests/unit/plan-table-render.test.ts` (`react-dom/server`, no new deps):
- **R1** `ok:false` (`missing_params`) → renders `data-testid="plan-table-error"` with the message, and **no** `data-testid="plan-table"`. (PRD US-01 AC explanatory state.)
- **R2** `ok:false` (`rest_exceeds_budget`) → renders the rest message.
- **R3** Zero-station valid plan → exactly one `data-testid="plan-row"` labelled "Start → Finish" + totals (proves "not empty/broken").

Anti-patterns to avoid (carried from the test plan, confirmed applicable): expected values
copied from the calc's own output (use hand-derived numbers like the existing file does);
happy-path-only; adding e2e where a unit/render test catches it.

## Code References

- `src/lib/plan-table.ts:40-46` — missing_params guard
- `src/lib/plan-table.ts:57-60` — station filter + sort (handles entry order; drops beyond-finish)
- `src/lib/plan-table.ts:63-72` — rest_exceeds_budget guard
- `src/lib/plan-table.ts:96-116` — segment build; `rawDistance > 0` skip; `Math.max(0,…)` clamp
- `src/lib/plan-table.ts:120-123` — invalid start_time guard
- `src/components/plans/PlanTable.tsx:171-180` — `ok:false` explanatory-state render (untested)
- `src/lib/schemas.ts:6,26-55` — `nonNegative` + aid-station schemas (no cross-field rule)
- `tests/unit/plan-table.test.ts:1-3,53-214` — calc tests with independent oracle (extend here)
- `tests/unit/plan-table-render.test.ts:6-9,80-117` — `renderToStaticMarkup` seam (extend here)
- `tests/plans-setup.spec.ts:48-66,68-97` — e2e out-of-order sort + happy generate
- `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql` — no CHECK constraints

## Architecture Insights

- **The pure calc is the validation backstop.** With no DB CHECKs and only per-field Zod, the
  app's correctness for degenerate input lives entirely in `computePlanTable`'s sort + guards.
  That is a deliberate, reasonable design for an MVP — but it means the calc's defensive
  branches are production-critical and must stay under regression test.
- **Stations are a set, not a list.** Sorting at compute time (not insertion) is the chosen
  model and matches PRD US-04. Any test or future rule must respect that "order" is derived,
  not stored.
- **Reactive derivation, no generate button.** The table recomputes via `useMemo` on edit;
  the read-only view computes once server-side. Both consume the same pure function, so a
  single set of pure-calc + render-state unit tests covers every surface.

## Historical Context (from prior changes)

- `context/archive/2026-06-15-generate-plan-table/` — S-02, the wedge; origin of the calc and
  its golden-number test.
- `context/archive/2026-06-17-gpx-import/` — added per-metric calibration (`metricCalibration`,
  raw-vs-corrected totals) and the `cumulative_elevation_loss_m` field; explains the
  calibration tests at `plan-table.test.ts:173-214`.
- `context/archive/2026-06-19-gear-total-summary/` — origin of `plan-table-render.test.ts`
  (established the `renderToStaticMarkup` pattern this phase reuses).

## Backport corrections for `context/foundation/test-plan.md` §2 (Risk #1)

These are response-guidance/wording corrections (no file anchors added — principle #3 holds).
Surface to `/10x-test-plan` for the post-research backport check, or defer to `--refresh`:

1. **Reframe the risk wording.** "Cumulative distances that decrease (go backwards) →
   negative segment distance / crash" is not borne out — stations are an unordered set, the
   calc sorts, and negatives are rejected by Zod. Replace with the real, defensible set:
   *degenerate aid-station sets (duplicate cumulative distance, station beyond total,
   non-monotonic cumulative elevation, out-of-order entry) plus the missing-param /
   rest-over-budget explanatory states — all handled by the pure calc and its render branch
   but lacking cheap-layer regression tests.*
2. **"Must challenge: client validation is enough"** — confirmed correct to challenge; keep
   it. Research proves there is no server-side cross-field validation and no DB CHECK; the
   calc is the only guard.
3. **Cheapest-layer correction.** §2 said "unit (derivation) + integration (rendered
   zero-station state)." The rendered state is a **unit render test** (`react-dom/server`),
   not integration. Phase 1 needs no integration or e2e additions.

## Open Questions

- **Validation policy (for `/10x-plan` / possibly a separate change):** should the API/DB
  *reject* `cumulative_distance > total` and `Infinity` (code change), or is documenting the
  calc's silent-drop via tests sufficient for now? Recommendation: test-only for this
  rollout; open a separate change if the team wants hard rejection.
- **Non-monotonic elevation clamp:** is clamping a decreasing cumulative gain to 0 the
  intended product behavior, or should it surface a warning? Phase 1 should at minimum lock
  the current behavior; a UX decision can follow.

## Hot-spot evidence check

Not misleading. The risk's likelihood evidence (`src/components/plans` 5 commits/30d — top
file `PlanTable.tsx`; `src/lib`) lands exactly on the untested render-state branch
(`PlanTable.tsx:171-180`) and the calc (`src/lib/plan-table.ts`). Churn and risk surface
coincide.

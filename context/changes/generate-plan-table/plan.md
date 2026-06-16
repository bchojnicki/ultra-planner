# Generate Plan Table (S-02) Implementation Plan

## Overview

Compute and live-render the correct segment-by-segment plan table — the product wedge (per-time-on-feet-per-segment nutrition). Derive segments from the S-01 data (plan params + distance-sorted aid stations), apply the PRD Business Logic, and surface the result through a merged, reactive editor on `/plans/[id]`. No schema change, no persistence (S-04 owns persist/display of the table); this slice computes on read and renders live.

## Current State Analysis

- **All inputs exist (S-01/F-01).** `plans` carries `total_distance_km`, `total_elevation_gain_m`, `start_time`, `total_expected_minutes`, `hourly_fluid_ml/carb_g/sodium_mg`; `aid_stations` carries `cumulative_distance_km`, `cumulative_elevation_gain_m`, `time_spent_min`, six facility flags, `notes`. Loaded via `getPlan` / `listAidStations` (`src/lib/services/`). Types in `src/types.ts`.
- **The editor uses two independent islands.** `src/pages/plans/[id].astro` mounts `RaceSetupForm` (autosaves params) and `AidStationManager` (add/list/delete) as separate `client:load` React roots. They don't share state — a live table needs them under one root.
- **Algorithm is fully specified** (PRD Business Logic): `segment_weight = segment_distance + k·segment_elevation_gain`, `k = 0.01 km/m`; per-segment time = share of the **moving** budget by weight; nutrition = hourly targets × segment moving-hours.
- **Test infra**: Vitest (`vitest.config.ts` → `tests/integration/**`, local Supabase) + Playwright (`tests/*.spec.ts`, gated on `TEST_EMAIL`/`TEST_PASSWORD`). The calc is pure → a fast unit suite with no DB.
- **Conventions** (CLAUDE.md): shared types in `src/types.ts`; helpers in `src/lib/`; React hooks in `src/components/hooks/`; `cn()` for class merging.

## Desired End State

On `/plans/[id]`, as the runner edits parameters and aid stations, a plan table updates live (no explicit generate action) showing one row per segment across the **whole race** — start → each station → finish — with distance, elevation gain, moving time, clock arrival, fluid/carb/sodium, and the end-station's facilities/rest/notes, plus a totals row. With **zero aid stations** the table is a single start→finish row. When **distance, elevation gain, or expected finish time is missing** (≤ 0), or rest time ≥ expected time, the table area shows a clear error/prompt instead. The calculation is a pure, unit-tested function whose golden-number tests encode the PRD formula.

Verify by: `npx vitest run` (golden-number calc tests pass), `npx tsc --noEmit` + `npm run lint` + `npm run build` clean, and the Playwright e2e asserting rendered table numbers for a known plan.

### Key Discoveries:

- Compute-on-read, no new column — F-01's guard: "S-02 generates, S-04 persists/displays."
- Request-scoped client + services already provide the data; the table is derived state only (no new endpoints).
- `time_spent_min` participates in the time model (decided): total = moving + rest, so it reduces the moving budget and shifts arrivals.
- Float-internal/round-at-display protects the PRD calculation-accuracy guardrail.

## What We're NOT Doing

- **No persistence of the generated table** — S-04 (read-only saved view) owns persist/display. This slice computes live.
- **No gear/unit-level output** — S-03 (FR-004). The table shows gram/ml targets only.
- **No new schema, endpoints, or migration** — pure derivation over existing data.
- **No editing model changes** — S-01's autosave + add/delete behavior is preserved, only lifted under one island.
- **No elevation-loss / advanced pacing model** — Naismith with fixed `k` only (PRD), uses elevation **gain**; `total_elevation_loss_m` is not consumed by the calc.

## Implementation Approach

Three phases, calc-first so the wedge is validated before any UI:

1. **Pure calc + golden-number unit tests** — the heart; independently verifiable, no UI.
2. **Merge the editor into one reactive `PlanEditor` island** — lift live state so the table can read it; preserve S-01 behavior (no table yet).
3. **Render `PlanTable`** from the computed result (table / error / zero-station states, totals, facilities) + e2e.

## Critical Implementation Details

- **Time model (decided).** `total_rest = Σ time_spent_min`; `moving_minutes = total_expected_minutes − total_rest`. Distribute `moving_minutes` across segments by weight. Nutrition uses each segment's moving-hours. Clock arrival accumulates moving time + rest at *preceding* stations, so arrival-at-finish = `start_time + total_expected_minutes` exactly. If `moving_minutes ≤ 0` → error (`rest_exceeds_budget`).
- **Required params.** `total_distance_km > 0`, `total_elevation_gain_m > 0`, `total_expected_minutes > 0` are required; otherwise an error result (`missing_params`). Required distance > 0 guarantees Σweights > 0 (no divide-by-zero).
- **Segment boundaries.** Points = `start(0,0)` + each aid station with `0 < cumulative_distance_km < total_distance_km` (in ascending order) + `finish(total_distance_km, total_elevation_gain_m)`. Skip any zero/negative-length segment (e.g. a station exactly at the finish, or duplicate cumulative distance). Clamp a negative per-segment elevation delta to 0 (cumulative gain should be monotonic).
- **Accuracy guardrail.** All arithmetic in floating point; round only when rendering. Never derive totals from rounded per-segment values.

## Phase 1: Plan-table calculation + golden-number unit tests

### Overview

Author the pure calculation and prove it against hand-computed expectations.

### Changes Required:

#### 1. Result/row types

**File**: `src/types.ts` (modify)

**Intent**: Shared types for the computed table so the calc and UI agree.

**Contract**: export `PlanTableRow` (segment label, `segment_distance_km`, `segment_elevation_gain_m`, `moving_minutes`, `arrival` ISO string, `fluid_ml`, `carb_g`, `sodium_mg`, and `endStation: AidStation | null` where `null` = finish), `PlanTableTotals` (distance, elevation gain, moving minutes, rest minutes, fluid/carb/sodium, `finish_arrival` ISO), and a discriminated `PlanTableResult = { ok: true; rows; totals } | { ok: false; error: "missing_params" | "rest_exceeds_budget"; message: string }`. Values stay numeric (floats); formatting is the UI's job.

#### 2. Calculation function

**File**: `src/lib/plan-table.ts` (new)

**Intent**: One pure function implementing the PRD Business Logic; the single source of truth for the wedge.

**Contract**: `computePlanTable(plan: Plan, stations: AidStation[]): PlanTableResult`, plus an exported `const SEGMENT_ELEVATION_WEIGHT_K = 0.01`. Pure (no I/O, no Date.now besides parsing `plan.start_time`). Implements the time model, required-param validation, segment boundaries, and rounding policy from Critical Implementation Details. Returns the error variants rather than throwing.

#### 3. Vitest unit glob

**File**: `vitest.config.ts` (modify)

**Intent**: Run pure unit tests (no Supabase) alongside the existing integration suite.

**Contract**: add `tests/unit/**/*.test.ts` to `test.include`.

#### 4. Golden-number tests

**File**: `tests/unit/plan-table.test.ts` (new)

**Intent**: Encode the PRD formula as independently hand-computed expectations so a regression in the wedge fails loudly.

**Contract**: cover (a) the worked example below; (b) zero stations → single start→finish row; (c) rest-time reduces moving budget and shifts arrivals (arrival-at-finish == start + expected); (d) `missing_params` when distance/gain/expected ≤ 0; (e) `rest_exceeds_budget` when Σrest ≥ expected; (f) a station at the finish produces no zero-length trailing row. Assert per-segment distances/weights/moving-minutes/nutrition and the finish arrival with explicit numbers (use `toBeCloseTo` for floats).

**Worked reference** (the implementer must reproduce these): plan = 100 km, 2000 m gain, expected 600 min, hourly 500 ml / 60 g / 700 mg, start `06:00`; one station at 40 km / 1000 m / rest 10 min.
- Weights: seg1 (start→AS1) = 40 + 0.01·1000 = **50**; seg2 (AS1→finish) = 60 + 0.01·1000 = **70**; Σ = 120.
- moving = 600 − 10 = **590**; moving1 = 590·50/120 = **245.833 min**; moving2 = 590·70/120 = **344.166 min**.
- seg1 nutrition (moving1 = 4.0972 h): fluid ≈ **2048.6 ml**, carb ≈ **245.8 g**, sodium ≈ **2868.1 mg**.
- arrival AS1 = 06:00 + 245.833 min ≈ **10:05**; arrival finish = 06:00 + 245.833 + 10 (rest) + 344.166 = 600 min = **16:00** (== start + expected). ✅

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Calc unit tests pass: `npx vitest run tests/unit/plan-table.test.ts`

#### Manual Verification:

- The golden-number expectations were independently re-derived from the PRD formula and agree with the worked reference (guards against code-and-test sharing the same wrong number).

**Implementation Note**: After this phase and its automated verification pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Merge `/plans/[id]` into one reactive PlanEditor island

### Overview

Bring params and stations under a single React root so the table can read live state, without changing S-01 behavior.

### Changes Required:

#### 1. PlanEditor island

**File**: `src/components/plans/PlanEditor.tsx` (new)

**Intent**: Parent island owning the live `plan` (params) and `stations` state, rendering the two S-01 components as children; the holder the Phase 3 table will compute from.

**Contract**: props = the initial `Plan` and `AidStation[]`. Holds mirror state for both; passes the existing children their data plus upward-change callbacks. No table yet (a placeholder region is fine). Default export, no `"use client"`.

#### 2. RaceSetupForm emits param changes

**File**: `src/components/plans/RaceSetupForm.tsx` (modify)

**Intent**: Let the parent observe live param values for the table while keeping autosave intact.

**Contract**: add an optional `onParamsChange?: (plan: Plan) => void` prop, invoked from the existing `update()` with the current parsed `Plan` (base plan merged with valid parsed fields; invalid/empty fields keep the base value). Autosave/PATCH behavior unchanged. Backward compatible (prop optional).

#### 3. AidStationManager emits station changes

**File**: `src/components/plans/AidStationManager.tsx` (modify)

**Intent**: Let the parent observe the live station list.

**Contract**: add an optional `onStationsChange?: (stations: AidStation[]) => void` prop, invoked after a successful add or delete with the new sorted list. Existing POST/DELETE + sorting behavior unchanged.

#### 4. Mount PlanEditor

**File**: `src/pages/plans/[id].astro` (modify)

**Intent**: Replace the two separate island mounts with the single merged island.

**Contract**: mount `PlanEditor` (`client:load`) with `plan` + `stations`, removing the direct `RaceSetupForm`/`AidStationManager` mounts (they now render inside PlanEditor). Page heading/back-link unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- Existing S-01 e2e still passes: `npx playwright test tests/plans-setup.spec.ts`

#### Manual Verification:

- Editing parameters still autosaves (Saving → Saved); reload persists.
- Add / delete aid station still works and stays distance-sorted.
- No visual regression on the editor page.

**Implementation Note**: After this phase and its automated verification pass, pause for manual confirmation before Phase 3.

---

## Phase 3: PlanTable rendering + e2e

### Overview

Render the live computed table (and its error/zero-station states) and prove the numbers reach the UI.

### Changes Required:

#### 1. PlanTable component

**File**: `src/components/plans/PlanTable.tsx` (new)

**Intent**: Present a `PlanTableResult` — table, error, or zero-station single row.

**Contract**: props = `PlanTableResult`. On `ok: false`, render the error/prompt message (missing params vs rest-exceeds-budget). On `ok: true`, render one row per segment with: leg label, distance, elevation gain, moving time (h:mm), clock arrival (HH:mm local from the ISO), fluid (ml, whole), carbs (g, whole), sodium (mg, whole), and the `endStation` facilities as inline badges + rest min + notes (finish row has none); plus a totals row. Round only at render; use `cn()` for styling; responsive at mobile width.

#### 2. Compute + render in PlanEditor

**File**: `src/components/plans/PlanEditor.tsx` (modify)

**Intent**: Wire the live calc to the view.

**Contract**: `useMemo(() => computePlanTable(plan, stations), [plan, stations])`; render `PlanTable` with the result in the placeholder from Phase 2. Recomputes on every param/station change (live).

#### 3. E2e assertion on rendered numbers

**File**: `tests/plans-setup.spec.ts` (modify)

**Intent**: Confirm correct figures render end-to-end.

**Contract**: extend the gated e2e — after setting known params (the worked-reference values) and adding the 40 km station, assert the table shows the expected first-segment values and finish arrival (`16:00`). Add `data-testid`s as needed.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- E2e passes with test credentials: `npx playwright test tests/plans-setup.spec.ts`

#### Manual Verification:

- The table updates live as params/stations change (no re-trigger).
- Zero aid stations → a single start→finish row.
- Missing a required param (distance / elevation gain / expected time) → error/prompt, not a broken table.
- Increasing a station's rest time pushes later arrivals and shrinks moving time per segment; finish arrival stays at start + expected.
- Facilities/rest/notes and the totals row render correctly; layout usable on mobile.

**Implementation Note**: After this phase and its automated verification pass, pause for final manual confirmation.

---

## Testing Strategy

### Unit (Vitest, Phase 1):

- Golden-number calc: worked reference, zero-station single segment, rest-time effect, `missing_params`, `rest_exceeds_budget`, station-at-finish no zero-row.

### End-to-end (Playwright, Phase 3):

- Known plan → table renders expected first-segment numbers + finish arrival.
- (Phase 2) S-01 flow regression: autosave + add/delete still pass.

### Manual Testing Steps:

1. Open a plan, complete required params → table appears; clear one → error state.
2. Add/remove stations and edit rest times → rows, arrivals, and totals update live.
3. Cross-check one segment against the worked reference by hand.

## Performance Considerations

NFR: table appears < 1s for up to 50 stations. The calc is O(stations) pure arithmetic and runs client-side on each edit (memoized) — negligible at this scale.

## Migration Notes

None — pure derivation over existing F-01/S-01 data; no schema or data changes.

## Addendum

- **`src/pages/plans/[id].astro` (Phase 3)** — widened the editor container `max-w-2xl` → `max-w-5xl` (user-requested during manual verification) so the wider islands and the 9-column plan table fit with less horizontal scrolling. Cosmetic; not in the original Phase 3 file contract.
- **`src/lib/aid-station-facilities.ts` (impl-review F3)** — extracted the shared `AID_STATION_FLAGS` tuple + `enabledFacilities` helper, consumed by both `AidStationManager` and `PlanTable` (removed the duplicated copies).

## References

- Roadmap: `context/foundation/roadmap.md` → S-02 (generate-plan-table); North star
- PRD: `context/foundation/prd.md` → US-01, FR-007, NFR (instant), Business Logic
- Upstream (archived): `context/archive/2026-06-15-race-setup-and-aid-stations/plan.md`; data layer `context/archive/2026-06-03-plan-data-and-ownership/`
- Reuse: `src/lib/services/{plans,aid-stations}.ts`, `src/types.ts`, `src/components/plans/{RaceSetupForm,AidStationManager}.tsx`, `src/pages/plans/[id].astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Plan-table calculation + golden-number unit tests

#### Automated

- [x] 1.1 Type checking passes (`npx tsc --noEmit`) — 2b7464e
- [x] 1.2 Lint passes (`npm run lint`) — 2b7464e
- [x] 1.3 Calc unit tests pass (`npx vitest run tests/unit/plan-table.test.ts`) — 2b7464e

#### Manual

- [x] 1.4 Golden-number expectations independently re-derived from the PRD formula (match the worked reference) — 2b7464e

### Phase 2: Merge `/plans/[id]` into one reactive PlanEditor island

#### Automated

- [x] 2.1 Type checking passes (`npx tsc --noEmit`) — 2b1e4ae
- [x] 2.2 Lint passes (`npm run lint`) — 2b1e4ae
- [x] 2.3 Production build succeeds (`npm run build`) — 2b1e4ae
- [x] 2.4 Existing S-01 e2e still passes (`npx playwright test tests/plans-setup.spec.ts`) — 2b1e4ae

#### Manual

- [x] 2.5 Params still autosave (Saving → Saved) and persist on reload — 2b1e4ae
- [x] 2.6 Add / delete aid station still works and stays distance-sorted — 2b1e4ae
- [x] 2.7 No visual regression on the editor page — 2b1e4ae

### Phase 3: PlanTable rendering + e2e

#### Automated

- [x] 3.1 Type checking passes (`npx tsc --noEmit`) — 21bd40a
- [x] 3.2 Lint passes (`npm run lint`) — 21bd40a
- [x] 3.3 Production build succeeds (`npm run build`) — 21bd40a
- [x] 3.4 E2e passes with test credentials (`npx playwright test tests/plans-setup.spec.ts`) — 21bd40a

#### Manual

- [x] 3.5 Table updates live as params/stations change (no re-trigger) — 21bd40a
- [x] 3.6 Zero aid stations → single start→finish row — 21bd40a
- [x] 3.7 Missing a required param → error/prompt, not a broken table — 21bd40a
- [x] 3.8 Higher rest time shifts later arrivals; finish arrival stays at start + expected — 21bd40a
- [x] 3.9 Facilities/rest/notes + totals render; layout usable on mobile — 21bd40a

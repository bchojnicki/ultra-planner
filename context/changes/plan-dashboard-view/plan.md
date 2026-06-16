# Plan Dashboard — Read-Only Saved-Plan View Implementation Plan

## Overview

Deliver the read-only "view a saved plan" experience (roadmap S-04 → US-07 / FR-009, plus the US-03 empty-dashboard criterion). When a runner selects a plan from the dashboard, it opens **read-only** — race parameters, aid stations, gear profile, and the generated plan table are displayed but cannot be edited. The editable creation/edit flow is preserved by moving it to a sibling `/plans/[id]/edit` route; a single "Edit plan" link bridges the two.

The dashboard listing and empty state already exist (`src/pages/dashboard.astro`), and the plan table is computed on read (`src/lib/plan-table.ts` — pure `computePlanTable`), so no schema, API, or calculation changes are needed.

## Current State Analysis

- **Dashboard** (`src/pages/dashboard.astro`) already lists plans by name + last-updated date (sorted `updated_at` desc via `listPlans`), renders an empty state, and has a "+ New plan" button that POSTs to `/api/plans`. This satisfies the dashboard half of US-07 and the US-03 empty-dashboard AC today.
- **Plan view is editable.** `src/pages/plans/[id].astro` renders `PlanEditor` (`src/components/plans/PlanEditor.tsx`), which mounts the autosaving `RaceSetupForm`, `GearProfileForm`, `AidStationManager`, and an interactive `PlanTable` (expandable per-segment gear panels with limit/override inputs). US-07 requires the *selected-from-dashboard* view to be read-only.
- **Plan creation** flows through the editor: `POST /api/plans` (`src/pages/api/plans/index.ts:18`) calls `createDraftPlan` (placeholder zeros) and redirects to `/plans/${plan.id}`.
- **The plan table is derived, never persisted.** `computePlanTable(plan, stations)` returns a discriminated `PlanTableResult` (`ok: true` with rows/totals, or `ok: false` with `missing_params` / `rest_exceeds_budget` and a human message). Recompute on load is deterministic, so "render as last generated without re-triggering generation" is automatically satisfied.
- **Gear allocation is derived too.** `PlanEditor` maps each table row through `computeGearAllocation({ carbTarget, fluidTarget, sodiumTarget, items, selections })` (`src/lib/gear-allocation.ts`) to produce per-segment unit suggestions. This mapping is pure and can run server-side.
- **`PlanTable`** (`src/components/plans/PlanTable.tsx`) shows the Fuel column and achieved-vs-target deltas whenever `gearActive` (items present and `allocations.length === rows.length`). It always renders a "▸ gear" toggle button when `gearActive`; the expandable limit/override panels render only when both `gearActive` and `onSelectionChange` are provided.
- **Middleware** (`src/middleware.ts`) gates the `/plans` prefix — both `/plans/[id]` and `/plans/[id]/edit` are covered with no change.
- **Tests:** Playwright e2e (`tests/plans-setup.spec.ts`, `tests/gear-units.spec.ts`) are gated behind `TEST_EMAIL`/`TEST_PASSWORD`, run against local Supabase, and use a `waitHydrated` helper (waits for `astro-island[ssr]` count to reach 0). `plans-setup.spec.ts` waits on `waitForURL(/\/plans\/.+/)` after "New plan".

## Desired End State

A logged-in runner on the dashboard selects a plan and lands on a read-only page showing all entered race parameters, aid stations, gear profile, and the generated plan table (in whole-unit Fuel form when gear is defined, gram/ml/mg otherwise). No inputs, save indicators, add/delete, or gear expand controls are present. A single "Edit plan" link leads to `/plans/[id]/edit`, the editable flow used for both initial creation and later edits. A runner with no plans still sees the existing empty-state prompt. An incomplete draft displays whatever values exist plus the calc's existing explanatory message in place of table rows.

Verify by: opening a saved plan from the dashboard shows no form inputs and a rendered table; the "Edit plan" link reaches the editor; "+ New plan" lands directly in the editor; the read-only page ships no hydrated island for the plan table.

### Key Discoveries:

- Read-only rendering needs no client JS: a React component rendered in an `.astro` page *without* a `client:*` directive is server-rendered to static HTML (`src/pages/plans/[id].astro` currently uses `client:load` for the editor — the read-only table simply omits it).
- The Fuel column requires only `items` + `allocations` (`PlanTable.tsx:170`); omitting `onSelectionChange` already suppresses the expand panels (`PlanTable.tsx:280`). Only the "▸ gear" toggle button needs an explicit `readOnly` guard.
- The allocation mapping in `PlanEditor` (`PlanEditor.tsx:36-47`) is duplicated work the read-only page also needs — extract it once into `src/lib/gear-allocation.ts`.
- `computePlanTable`'s `ok: false` branch (`plan-table.ts:26-32`, `43-50`) already supplies the exact "explanatory state" US-01 demands; the read-only page reuses it by passing the result straight to `PlanTable`.

## What We're NOT Doing

- **No delete from the dashboard** — US-09 / FR-011 is the next slice (S-05).
- **No rename** — FR-010 is v2.
- **No new "edit saved plan" UX** beyond linking to the existing editor — full edit polish is v2.
- **No dashboard redesign** — the existing name + updated-date list stays; no new columns, filters, or sort controls.
- **No schema, API endpoint, or calculation changes** — the read-only view is pure presentation over existing data + existing pure functions.

## Implementation Approach

Split the single editable route into two: `/plans/[id]` (read-only, the dashboard target) and `/plans/[id]/edit` (the existing editor island, the create/edit target). Repoint the create redirect to `/edit`. Build three small `.astro` presentational components mirroring the three editor sections, and render the existing `PlanTable` in a `readOnly` mode with no hydration. Compute the table result and gear allocations server-side in the read-only page using the existing pure functions (with the allocation mapping extracted to a shared helper). Cover the path with one Playwright e2e.

## Phase 1: Routing split + editor relocation

### Overview

Separate the editable flow from the view route without changing any editor behavior. After this phase, `/plans/[id]/edit` is the editor, `/plans/[id]` is a (temporary) minimal read-only shell, and creation lands in the editor.

### Changes Required:

#### 1. New editor route

**File**: `src/pages/plans/[id]/edit.astro`

**Intent**: House the existing editable experience at the `/edit` sub-route. Move the current contents of `src/pages/plans/[id].astro` here (data loading + `<PlanEditor client:load />`), and add a "← Back to plan" link pointing to the read-only view `/plans/[id]`.

**Contract**: Loads `plan`/`stations`/`gearItems`/`gearSelections` via the request-scoped client (same calls as today); redirects to `/dashboard` when the plan is missing/non-owned. Renders `PlanEditor` with the same props. Route resolves to `/plans/:id/edit`. (Astro allows `[id].astro` and the `[id]/` folder to coexist.)

#### 2. Read-only shell route

**File**: `src/pages/plans/[id].astro`

**Intent**: Reduce this page to a read-only shell. In Phase 1 it loads the plan and renders a placeholder (heading + "Edit plan" link); Phase 2 fills in the full read-only content. Keep the missing/non-owned → `/dashboard` redirect.

**Contract**: Same data-loading guard as today. Renders the plan name heading, a "← Back to plans" link to `/dashboard`, and an "Edit plan" link to `/plans/[id]/edit`. No `PlanEditor`, no `client:*` island.

#### 3. Repoint create redirect

**File**: `src/pages/api/plans/index.ts`

**Intent**: New plans must open in the editor, not the read-only view.

**Contract**: Change the redirect target from `/plans/${plan.id}` to `/plans/${plan.id}/edit`. (Existing e2e `waitForURL(/\/plans\/.+/)` still matches.)

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`
- Existing plan e2e still passes (URL regex matches `/edit`): `npx playwright test tests/plans-setup.spec.ts` (with `TEST_EMAIL`/`TEST_PASSWORD` set against local Supabase)

#### Manual Verification:

- "+ New plan" on the dashboard lands on `/plans/[id]/edit` with the editable forms
- Navigating to `/plans/[id]` shows the read-only shell with a working "Edit plan" link
- A non-owned or missing plan id on either route redirects to `/dashboard`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Read-only view (presentational components + read-only table)

### Overview

Fill the read-only shell with dedicated presentational components and a non-interactive plan table that shows the full generated output.

### Changes Required:

#### 1. Read-only flag on the plan table

**File**: `src/components/plans/PlanTable.tsx`

**Intent**: Allow the table to render its full output (Fuel column + deltas) with no editing affordances. The expand panels already require `onSelectionChange`; only the "▸ gear" toggle button needs suppressing.

**Contract**: Add an optional `readOnly?: boolean` prop. When `readOnly` is true, do not render the per-row gear toggle button (`PlanTable.tsx:218-230`) and do not render the save-status line. The Fuel column, nutrient deltas, totals, and aid-station context render unchanged.

#### 2. Shared allocation helper

**File**: `src/lib/gear-allocation.ts`

**Intent**: Extract the per-segment allocation mapping currently inlined in `PlanEditor` so both the editor and the read-only page derive allocations identically.

**Contract**: Add a pure exported function that takes the `PlanTableResult`, `GearItem[]`, and `GearSegmentSelection[]` and returns `GearAllocationResult[]` parallel to the rows (empty array when the result is not `ok`). Mirrors the logic at `PlanEditor.tsx:36-47`.

#### 3. Use the helper in the editor

**File**: `src/components/plans/PlanEditor.tsx`

**Intent**: Replace the inline `useMemo` allocation mapping with the shared helper to prevent drift. Behavior unchanged.

**Contract**: `allocations` `useMemo` calls the new helper with `(result, gearItems, selections)`. No prop or output changes.

#### 4. Race-parameters summary

**File**: `src/components/plans/PlanSummary.astro`

**Intent**: Display the saved race parameters as a read-only labeled value grid mirroring `RaceSetupForm`'s fields.

**Contract**: Props: `{ plan: Plan }`. Renders name, total distance (km), elevation gain/loss (m), start time, expected finish (formatted h/m from `total_expected_minutes`), and hourly fluid/carb/sodium targets. No inputs. Matches the existing card styling (`rounded-2xl border border-white/10 bg-white/10 …`).

#### 5. Aid-stations list

**File**: `src/components/plans/AidStationList.astro`

**Intent**: Display the plan's aid stations read-only, sorted by cumulative distance, with facility badges, rest time, and crew notes.

**Contract**: Props: `{ stations: AidStation[] }`. Sorts by `cumulative_distance_km`; per station shows cumulative distance/elevation, facility badges via `enabledFacilities(station)` (`src/lib/aid-station-facilities.ts`), `time_spent_min` when > 0, and `notes` when present. Renders an empty hint when there are none. No add/delete controls.

#### 6. Gear catalog list

**File**: `src/components/plans/GearList.astro`

**Intent**: Display the gear catalog read-only.

**Contract**: Props: `{ items: GearItem[] }`. Per item shows kind label, name, and the per-unit nutrition fields relevant to its kind (carb_g / sodium_mg / fluid_ml / capacity_ml / carb_ratio). Renders the same "No gear — table shows gram/ml targets" hint as the editor when empty. No inputs/delete.

#### 7. Assemble the read-only page

**File**: `src/pages/plans/[id].astro`

**Intent**: Replace the Phase 1 placeholder with the full read-only view: summary, aid stations, gear, and the generated table.

**Contract**: After loading `plan`/`stations`/`gearItems`/`gearSelections`, compute `const result = computePlanTable(plan, stations)` and `const allocations = computeAllocations(result, gearItems, gearSelections)` in the frontmatter. Render `PlanSummary`, `AidStationList`, `GearList`, then `<PlanTable result={result} items={gearItems} allocations={allocations} readOnly />` with **no** `client:*` directive (static SSR). Keep the "← Back to plans" and "Edit plan" links. The `result.ok === false` case renders `PlanTable`'s existing explanatory message automatically.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`
- Unit/integration suites still green: `npx playwright test tests/unit tests/integration`

#### Manual Verification:

- Opening a complete saved plan from the dashboard shows parameters, aid stations, gear, and a rendered table with no inputs, no save indicators, and no gear expand toggles
- A gear-enabled plan shows the whole-unit Fuel column and achieved-vs-target deltas; a gearless plan shows gram/ml/mg targets
- An incomplete draft shows the saved values plus the "Enter total distance…" explanatory message instead of rows, with the "Edit plan" link available
- View source / devtools confirms the plan table is static HTML (no hydrated island) on `/plans/[id]`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: e2e test + verification

### Overview

Guard the read-only behavior end-to-end so a future change can't silently re-enable editing on the view route.

### Changes Required:

#### 1. Read-only view e2e spec

**File**: `tests/plan-view.spec.ts`

**Intent**: Cover the US-07 path: create a plan, fill the minimum to generate a table, open it read-only from the dashboard, assert it is non-editable and the table renders, then follow "Edit plan" to the editor.

**Contract**: Mirrors `tests/plans-setup.spec.ts` — gated behind `TEST_EMAIL`/`TEST_PASSWORD`, uses the `waitHydrated` helper, runs against local Supabase. Steps: sign in → "New plan" (lands on `/edit`) → fill name + the params required for a table (distance, elevation gain, expected finish, start time) and wait for "Saved" → go to `/dashboard` → click the plan → assert URL is `/plans/<id>` (not `/edit`), `getByTestId("plan-table")` is visible, no `save-status` / `gear-toggle` present, and there are no editable inputs → click "Edit plan" → assert URL ends with `/edit` and the editable forms are present.

### Success Criteria:

#### Automated Verification:

- New spec passes: `npx playwright test tests/plan-view.spec.ts` (with `TEST_EMAIL`/`TEST_PASSWORD` against local Supabase)
- Full e2e suite green: `npx playwright test`
- Linting passes: `npm run lint`

#### Manual Verification:

- The spec is skipped (not failed) when `TEST_EMAIL`/`TEST_PASSWORD` are unset, matching the other gated specs

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- No new unit tests required — the read-only view reuses `computePlanTable` and `computeGearAllocation`, already covered by `tests/unit/plan-table.test.ts` and `tests/unit/gear-allocation.test.ts`. The extracted `computeAllocations` helper is a thin mapping; existing integration coverage of allocation exercises it indirectly.

### Integration Tests:

- Existing `tests/integration/*` (plans-flow, gear-flow, rls-ownership) must stay green; the routing change must not affect data-layer ownership scoping.

### Manual Testing Steps:

1. Create a new plan → confirm it opens in the editor (`/edit`).
2. Fill parameters + add aid stations + add gear; return to the dashboard.
3. Click the plan → confirm read-only view: values shown, no inputs, table rendered with Fuel column.
4. Click "Edit plan" → confirm the editor opens and edits still autosave.
5. Create a fresh plan, leave it incomplete, view it read-only → confirm the explanatory message renders, not a broken table.

## Migration Notes

No data migration. The only externally observable change is the post-create redirect target (`/plans/[id]` → `/plans/[id]/edit`) and that dashboard links now open read-only.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-04)
- PRD: `context/foundation/prd.md` (US-07, FR-009, US-03 empty-dashboard AC)
- Plan table calc: `src/lib/plan-table.ts`
- Gear allocation: `src/lib/gear-allocation.ts`
- Existing editor + table: `src/components/plans/PlanEditor.tsx`, `src/components/plans/PlanTable.tsx`
- Existing e2e pattern: `tests/plans-setup.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Routing split + editor relocation

#### Automated

- [x] 1.1 Type checking passes: `npx astro sync && npm run build` — 4542f8c
- [x] 1.2 Linting passes: `npm run lint` — 4542f8c
- [x] 1.3 Existing plan e2e still passes: `npx playwright test tests/plans-setup.spec.ts` — 4542f8c

#### Manual

- [x] 1.4 "+ New plan" lands on `/plans/[id]/edit` with editable forms — 4542f8c
- [x] 1.5 `/plans/[id]` shows the read-only shell with a working "Edit plan" link — 4542f8c
- [x] 1.6 Non-owned/missing plan id redirects to `/dashboard` on both routes — 4542f8c

### Phase 2: Read-only view (presentational components + read-only table)

#### Automated

- [x] 2.1 Type checking passes: `npx astro sync && npm run build` — da4a585
- [x] 2.2 Linting passes: `npm run lint` — da4a585
- [x] 2.3 Unit/integration suites still green: `npx playwright test tests/unit tests/integration` — da4a585

#### Manual

- [x] 2.4 Complete saved plan shows params/stations/gear/table with no inputs, save indicators, or gear toggles — da4a585
- [x] 2.5 Gear plan shows Fuel column + deltas; gearless plan shows gram/ml/mg targets — da4a585
- [x] 2.6 Incomplete draft shows saved values + explanatory message, with "Edit plan" available — da4a585
- [x] 2.7 Plan table renders as static HTML (no hydrated island) on `/plans/[id]` — da4a585

### Phase 3: e2e test + verification

#### Automated

- [x] 3.1 New spec passes: `npx playwright test tests/plan-view.spec.ts`
- [x] 3.2 Full e2e suite green: `npx playwright test`
- [x] 3.3 Linting passes: `npm run lint`

#### Manual

- [x] 3.4 Spec is skipped (not failed) when `TEST_EMAIL`/`TEST_PASSWORD` are unset

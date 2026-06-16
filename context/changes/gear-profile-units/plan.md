# Gear Profile → Unit-Level Output (Hybrid) Implementation Plan

## Overview

Add a per-plan **gear catalog** and a **per-segment selection layer** so the generated plan table can show unit-level fueling (e.g. "1 drink + 9 gels + 2 bars") alongside the existing gram/ml targets. The model is **hybrid**: the app auto-suggests whole-unit quantities per segment from the runner's gear and a per-product ratio, and the runner can shape (per-stage unit limits) or directly override (exact units) those suggestions. A new **pure allocation function** does the gram→unit conversion; the existing `computePlanTable` math (`src/lib/plan-table.ts`) is not touched. The PRD and roadmap are reconciled to this hybrid model as part of the work.

## Current State Analysis

S-01 and S-02 are done and archived. The codebase has a clean, repeatable pattern at every layer this slice touches:

- **Data layer** — `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql` defines `plans` (owner via `user_id`) and `aid_stations` (owner via the **plan-subquery RLS pattern**: `plan_id in (select id from plans where user_id = (select auth.uid()))`). One policy per operation per role, `numeric`/`integer` columns, a `moddatetime` `updated_at` trigger, and a per-FK index. `src/types.ts` mirrors each table as `Entity` / `EntityInsert` / `EntityUpdate` and wires them into a `Database` interface used by the typed Supabase client (`src/lib/supabase.ts`).
- **Services** — `src/lib/services/plans.ts` and `src/lib/services/aid-stations.ts`: every function takes a request-scoped `client: SupabaseClient<Database>`, relies on RLS for ownership (no manual `user_id` filtering), and throws on error.
- **API** — `src/pages/api/plans/[id].ts` (PATCH autosave), `src/pages/api/plans/[id]/aid-stations.ts` (POST), `src/pages/api/aid-stations/[id].ts` (DELETE). Each reads `context.locals.user`, builds a request-scoped client, validates with a `z.strictObject` schema from `src/lib/schemas.ts`, calls the service, and maps errors (`PGRST116` → 404, `42501` → 403).
- **Forms** — `src/components/hooks/useAutosave.ts` is a debounced (700ms), coalescing autosave hook; `src/components/plans/RaceSetupForm.tsx` is the reference consumer (`schedule(buildPatch(next))` on every field change, passive status indicator).
- **Transform + UI** — `src/lib/plan-table.ts` exports the **pure** `computePlanTable(plan, stations): PlanTableResult`, producing `PlanTableRow[]` with exact-float `fluid_ml` / `carb_g` / `sodium_mg` per segment (each = hourly target × moving_minutes / 60). `src/components/plans/PlanTable.tsx` renders the rows (rightmost cell is already a multi-line flex layout). `src/components/plans/PlanEditor.tsx` is a **linear vertical stack** (`RaceSetupForm` → `AidStationManager` → `PlanTable`) with `result = useMemo(() => computePlanTable(params, stations), [params, stations])`.
- **Middleware** — `PROTECTED_ROUTES = ["/dashboard", "/plans"]` in `src/middleware.ts` already covers every route this slice adds (all under `/plans` and `/api/plans`).
- **Tests** — `tests/unit/plan-table.test.ts` (golden numbers), `tests/integration/plans-flow.test.ts` (RLS + zod), `tests/plans-setup.spec.ts` (Playwright flow).

What's missing: there is no gear schema, no gear service/endpoints, no allocation transform, and no gear UI. Gear is entirely net-new and decorative over the existing calc.

## Desired End State

A logged-in runner editing a plan sees a new **Gear** section between race setup and aid stations. There they define their gear items (gels, carb drink, solid food, water carrier, salt caps), each with its nutrition content and — for carb sources — a ratio/priority weight. The plan table then shows, per segment, whole-unit fueling as the primary value with the gram/ml target and a signed delta as secondary text. Each segment row expands to a panel where the runner can cap a product's units for that stage or set an exact override. Selections persist (sparse: only deviations are stored) and survive reload. Adding or deleting an aid station clears overrides for the segments whose indices no longer map, and auto-suggest re-seeds them. With no gear defined, the table is unchanged (gram/ml only). The PRD (FR-004, US-06) and roadmap (S-03) describe this hybrid model.

Verify by: running the new unit/integration/e2e tests green; manually defining gear and watching the table switch to units with a correct ±delta; setting a per-stage limit and seeing redistribution; overriding a cell and reloading to confirm persistence; deleting a station and confirming affected overrides clear.

### Key Discoveries:

- RLS plan-subquery pattern to mirror verbatim: `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql:103-135`.
- Pure transform to extend-alongside (never modify): `computePlanTable` at `src/lib/plan-table.ts:24`; row type `PlanTableRow` at `src/types.ts:97-107` (carb_g/fluid_ml/sodium_mg are exact floats, rounding is display-only).
- Autosave contract to reuse: `useAutosave<T>(saveFn, delay)` at `src/components/hooks/useAutosave.ts:10`; reference usage `src/components/plans/RaceSetupForm.tsx:102-126`.
- Editor insertion point: `src/components/plans/PlanEditor.tsx:21-28` — add `<GearProfileForm>` after `<RaceSetupForm>`, before `<AidStationManager>`; thread gear state into the `useMemo` alongside `params`/`stations`.
- API/service/zod patterns: `src/pages/api/plans/[id].ts`, `src/lib/services/plans.ts`, `src/lib/schemas.ts` (`z.strictObject`, `nonNegative`).
- Migration timestamp convention `YYYYMMDDHHmmss_short_description.sql`; new migrations use `20260616073640` and `20260616073641`.

## What We're NOT Doing

- **Not** altering `computePlanTable` or its gram/ml/time math — gear is a separate, additive transform layer (PRD calc-accuracy guardrail).
- **Not** building a per-user reusable gear library — the catalog is per-plan (a v2 concern).
- **Not** persisting auto-suggestions — only sparse per-stage limits and overrides are stored; suggestions are computed live.
- **Not** supporting fractional units — whole units only, round-to-nearest, with a visible ±delta.
- **Not** adding new protected routes config — everything lives under `/plans` and `/api/plans`, already gated.
- **Not** independent per-target ratios — carbs drive unit counts; fluid/sodium fill the gap (water carrier for fluid, salt caps for sodium).
- **Not** blocking aid-station edits when overrides exist — affected overrides are cleared instead.

## Implementation Approach

Build bottom-up so each layer is verifiable before the next depends on it: data model → services/API → pure allocation transform (the calc core, unit-tested in isolation) → catalog UI → table integration + e2e → docs. The allocation transform is the riskiest, calc-critical piece and is isolated in a pure function with golden-number tests, exactly as `computePlanTable` was. Persistence reuses the sparse-row + `useAutosave` pattern wholesale. Docs reconciliation is independent and lands last.

The two new tables:

- **`gear_items`** (per-plan catalog) — `plan_id` FK, a `kind` enum (`gel` | `drink` | `solid_food` | `water_carrier` | `salt_cap`), `name`, nullable per-kind nutrition fields (`carb_g`, `sodium_mg`, `fluid_ml` per unit/serving; `capacity_ml` for carriers), and `carb_ratio` weight (used only for carb allocation).
- **`gear_segment_selections`** (sparse per-stage overrides) — `plan_id` FK, `segment_index` (integer, 0-based ordinal into the computed `PlanTableRow[]`), `gear_item_id` FK, nullable `limit_units` (cap) and nullable `override_units` (exact). A row exists only when at least one of limit/override is set.

Both tables are owner-scoped via the plan-subquery RLS pattern (they have no `user_id` column).

## Critical Implementation Details

- **Allocation precedence (per segment, per source):** `override_units` (imperative) wins outright; otherwise the auto-suggestion runs, with `limit_units` capping a source and triggering redistribution. The suggestion is computed live; only limits/overrides are stored.
- **Carb-led coupling order:** (1) allocate the carb target across carb sources (gel/drink/solid_food) by `carb_ratio`, applying per-stage limits with an iterative redistribution cascade until stable; (2) the resulting drink units' fluid counts toward the fluid target, water carrier fills the remaining fluid gap; (3) the resulting gel/drink/food units' sodium counts toward the sodium target, salt caps fill the remaining sodium gap. This single deterministic pass avoids double-counting the drink's dual contribution.
- **Redistribution cascade is iterative:** capping one carb source releases grams that redistribute across the *uncapped* sources by ratio, which can push another source over its own limit. Loop until no uncapped source exceeds its cap (worst case: number of carb sources).
- **Segment-index reconciliation:** `segment_index` is a positional ordinal into the live `PlanTableRow[]`. On aid-station add/delete the segment count/order changes; selections whose `segment_index` no longer maps to a stable segment must be deleted server-side (or on the next save) so a quantity is never silently mis-attributed to the wrong leg. Auto-suggest re-seeds the affected segments.

## Phase 1: Data model & RLS

### Overview

Create the two tables with the plan-subquery RLS pattern, mirror them into `src/types.ts` and the `Database` interface, and add zod schemas. Cover the data layer with integration tests.

### Changes Required:

#### 1. Migration — gear_items catalog

**File**: `supabase/migrations/20260616073640_create_gear_items.sql`

**Intent**: Create the per-plan gear catalog with a kind discriminator, nullable per-kind nutrition fields, and a carb ratio weight; enable RLS with one policy per operation via the plan-subquery pattern.

**Contract**: Table `gear_items` — `id uuid pk default gen_random_uuid()`, `plan_id uuid not null references plans(id) on delete cascade`, `kind text not null` with a `check (kind in ('gel','drink','solid_food','water_carrier','salt_cap'))`, `name text not null`, `carb_g numeric`, `sodium_mg numeric`, `fluid_ml numeric`, `capacity_ml numeric`, `carb_ratio numeric not null default 1`, `created_at`/`updated_at timestamptz not null default now()`. Index on `plan_id`. `moddatetime` trigger on `updated_at`. Four RLS policies (`select`/`insert`/`update`/`delete`) `to authenticated` using/with-check `plan_id in (select id from plans where user_id = (select auth.uid()))` — copy the `aid_stations` policy block verbatim, renaming the table.

#### 2. Migration — gear_segment_selections

**File**: `supabase/migrations/20260616073641_create_gear_segment_selections.sql`

**Intent**: Create the sparse per-stage selection table holding optional unit limits and overrides keyed by segment ordinal and gear item.

**Contract**: Table `gear_segment_selections` — `id uuid pk`, `plan_id uuid not null references plans(id) on delete cascade`, `gear_item_id uuid not null references gear_items(id) on delete cascade`, `segment_index integer not null check (segment_index >= 0)`, `limit_units integer check (limit_units >= 0)`, `override_units integer check (override_units >= 0)`, timestamps. `unique (gear_item_id, segment_index)`. Index on `plan_id`. `moddatetime` trigger. Same four plan-subquery RLS policies as Phase 1.1.

#### 3. Shared types

**File**: `src/types.ts`

**Intent**: Add entity + Insert + Update types for both tables and register them in the `Database` interface so the typed client infers them.

**Contract**: `GearKind` union type; `GearItem` (all columns), `GearItemInsert = Omit<GearItem,"id"|"created_at"|"updated_at">` (requires `plan_id`), `GearItemUpdate = Partial<Omit<GearItem,"id"|"plan_id"|"created_at"|"updated_at">>`; `GearSegmentSelection` + matching Insert/Update DTOs. Add `gear_items` and `gear_segment_selections` keys to `Database["public"]["Tables"]` with `Row`/`Insert`/`Update`.

#### 4. Zod schemas

**File**: `src/lib/schemas.ts`

**Intent**: Add validation for gear item create/update and selection upsert, matching the existing `strictObject` + `nonNegative` style.

**Contract**: `gearItemCreateSchema` — `kind` enum, `name` min(1), optional non-negative `carb_g`/`sodium_mg`/`fluid_ml`/`capacity_ml`, `carb_ratio` non-negative default 1. `gearItemUpdateSchema` — all fields optional. `gearSelectionUpsertSchema` — `segment_index` int ≥ 0, `gear_item_id` uuid, nullable optional int `limit_units`/`override_units`. All `z.strictObject`.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly against a fresh local DB: `npx supabase db reset`
- Type checking passes: `npm run build` (astro check) or `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Integration tests for new-table RLS (owner can CRUD, non-owner blocked) and zod schemas pass: `npx playwright test tests/integration/gear-flow.test.ts`

#### Manual Verification:

- In the local Supabase studio, confirm both tables exist with the expected columns, the kind check constraint, and four RLS policies each.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Services & API endpoints

### Overview

Add gear-item and selection services plus API routes, mirroring the plans/aid-stations endpoint pattern exactly.

### Changes Required:

#### 1. Gear item service

**File**: `src/lib/services/gear-items.ts`

**Intent**: CRUD for catalog items, request-scoped client, RLS-scoped, throwing on error.

**Contract**: `listGearItems(client, planId): Promise<GearItem[]>`, `createGearItem(client, input: GearItemInsert): Promise<GearItem>`, `updateGearItem(client, id, patch: GearItemUpdate): Promise<GearItem>`, `deleteGearItem(client, id): Promise<void>`.

#### 2. Selection service

**File**: `src/lib/services/gear-selections.ts`

**Intent**: List, upsert (limit/override), and delete sparse per-stage selections; delete stale selections during reconciliation.

**Contract**: `listGearSelections(client, planId): Promise<GearSegmentSelection[]>`, `upsertGearSelection(client, input): Promise<GearSegmentSelection>` (upsert on `(gear_item_id, segment_index)`; if both `limit_units` and `override_units` resolve to null, delete the row instead), `deleteSelectionsForSegments(client, planId, segmentIndexes: number[]): Promise<void>`.

#### 3. API routes

**File**: `src/pages/api/plans/[id]/gear-items.ts` (GET list, POST create), `src/pages/api/gear-items/[id].ts` (PATCH, DELETE), `src/pages/api/plans/[id]/gear-selections.ts` (GET list, PUT upsert)

**Intent**: Expose the services following the existing endpoint shape.

**Contract**: Each handler: guard `context.locals.user` (401), build request-scoped client (500 if unconfigured), validate body with the Phase 1 zod schema (400 on failure), call the service, map `PGRST116` → 404 and `42501` → 403. POST/create returns the resource at 201; PATCH/PUT returns `{ updated_at }` or the upserted row.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Integration tests exercise each endpoint's happy path + ownership rejection (extend `tests/integration/gear-flow.test.ts`): `npx playwright test tests/integration/gear-flow.test.ts`

#### Manual Verification:

- With the dev server running, create/list/update/delete a gear item and upsert a selection via the network tab; confirm response shapes and that a second account cannot read another's items.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Pure allocation transform + unit tests

### Overview

Implement the carb-led allocation function and the override-reconciliation helper as pure functions, with golden-number unit tests. This is the calc-critical core and must not import or alter `computePlanTable`.

### Changes Required:

#### 1. Allocation transform

**File**: `src/lib/gear-allocation.ts`

**Intent**: Convert a segment's gram/ml targets into whole-unit suggestions per gear item, honoring ratio weights, per-stage limits (with iterative redistribution), direct overrides, the carb-led fluid/sodium gap-fill, and round-to-nearest; report achieved totals and signed deltas.

**Contract**: `computeGearAllocation(input: { carbTarget: number; fluidTarget: number; sodiumTarget: number; items: GearItem[]; selections: GearSegmentSelection[] }): GearAllocationResult`. `GearAllocationResult` (new type in `src/types.ts`) = per-item `{ gear_item_id, units }[]` plus `{ carb_g, fluid_ml, sodium_mg }` achieved totals and `{ carb_g, fluid_ml, sodium_mg }` deltas (achieved − target). Algorithm, in order: (a) carb sources = items with `carb_g > 0` among gel/drink/solid_food; apply `override_units` first (fixed), then split the remaining carb target across non-overridden carb sources by `carb_ratio`, cap any source at its `limit_units` (× carb_g), redistribute released grams across uncapped sources by ratio, loop until stable, then round each to nearest whole unit; (b) fluid: sum drink units' `fluid_ml`, fill remainder with water_carrier units (round to nearest); (c) sodium: sum gel/drink/food units' `sodium_mg`, fill remainder with salt_cap units (round to nearest); (d) compute achieved totals and deltas. Pure, deterministic, no I/O.

#### 2. Reconciliation helper

**File**: `src/lib/gear-allocation.ts` (same module)

**Intent**: Given the previous and next segment counts after a station add/delete, return the segment indexes whose stored selections are now stale and should be deleted.

**Contract**: `staleSegmentIndexes(prevSegmentCount: number, nextSegmentCount: number, existing: GearSegmentSelection[]): number[]` — returns indexes `>= nextSegmentCount` (and any other indexes the chosen positional rule deems unmappable). Used by the UI to call `deleteSelectionsForSegments`.

### Success Criteria:

#### Automated Verification:

- Golden-number unit tests pass (ratio split; limit cap + redistribution cascade; override-wins precedence; fluid gap-fill via carrier; sodium gap-fill via salt caps; round-to-nearest and delta sign; zero-gear no-op): `npx playwright test tests/unit/gear-allocation.test.ts`
- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Existing `tests/unit/plan-table.test.ts` still passes unchanged (proves the calc math was not touched).

#### Manual Verification:

- Walk the worked example by hand (400 g carbs, ratio drink 1 / gel 2 / solid 1, drink capped at 1 unit = 80 g → 320 g across gel/solid 2:1) and confirm the function's output matches.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Gear catalog UI

### Overview

Add the `GearProfileForm` section to the editor: define gear items per kind with their nutrition fields and carb ratio, autosaved.

### Changes Required:

#### 1. Gear profile form

**File**: `src/components/plans/GearProfileForm.tsx`

**Intent**: Let the runner add/edit/remove gear items, exposing only the fields relevant to each kind, with autosaved persistence; emit gear state upward so the table recomputes live.

**Contract**: Props `{ planId: string; initialItems: GearItem[]; onItemsChange?: (items: GearItem[]) => void }`. Per-kind field visibility: gel/solid_food → `carb_g`, `sodium_mg`, `carb_ratio`; drink → `carb_g`, `fluid_ml`, `sodium_mg`, `carb_ratio`; water_carrier → `capacity_ml`; salt_cap → `sodium_mg`. Create/delete call the Phase 2 endpoints; field edits use `useAutosave` against `PATCH /api/gear-items/[id]`. Section is optional/skippable. Reuse the visual style of `RaceSetupForm`/`AidStationManager`.

#### 2. Editor wiring

**File**: `src/components/plans/PlanEditor.tsx`

**Intent**: Slot the gear form between race setup and aid stations and thread gear state into the live computation.

**Contract**: Add `const [gearItems, setGearItems] = useState<GearItem[]>(initialGearItems)`; render `<GearProfileForm planId={plan.id} initialItems={initialGearItems} onItemsChange={setGearItems} />` between `<RaceSetupForm>` and `<AidStationManager>`. Extend `Props` with `initialGearItems: GearItem[]` and `initialSelections: GearSegmentSelection[]`. The page that renders `PlanEditor` must load both via the new list services.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- The Gear section appears between race setup and aid stations; adding a gel/drink/food/carrier/salt-cap shows only the relevant fields; edits autosave (status indicator) and survive reload; skipping the section leaves the plan table in gram/ml mode.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 5: Plan table integration + e2e

### Overview

Render unit-level output in the plan table with target/±delta, add the expandable per-row panel for limits/overrides, persist selections via autosave, and clear stale overrides on station change. Add one Playwright flow.

### Changes Required:

#### 1. Live allocation in the editor

**File**: `src/components/plans/PlanEditor.tsx`

**Intent**: Compute per-segment gear allocations live from the plan table rows, gear items, and selections, and trigger reconciliation when the segment count changes.

**Contract**: Add `const [selections, setSelections] = useState(initialSelections)`. Derive, per `PlanTableRow` index, a `GearAllocationResult` via `computeGearAllocation` using that row's `carb_g`/`fluid_ml`/`sodium_mg` as targets (memoized over rows + gearItems + selections). When `stations` change such that the row count changes, compute `staleSegmentIndexes` and call `deleteSelectionsForSegments`, then drop them from local state. Pass allocations + items + selections + a `scheduleSelection` autosave callback to `PlanTable`.

#### 2. Table display + per-row panel

**File**: `src/components/plans/PlanTable.tsx`

**Intent**: When gear items exist, show units as the primary value per nutrient with the gram/ml target and signed delta as secondary text; add an expandable panel per row exposing each source's suggested units, a limit input, and an override input.

**Contract**: Extend `Props` to accept `allocations`, `items`, `selections`, and `onSelectionChange`. For each segment row, when `items.length > 0`, render the unit breakdown (e.g. "1 drink + 9 gels") primary and `392/400 g (−8 g)` secondary in the existing multi-line cell style; gram/ml-only when no items. A disclosure control expands a panel with per-source rows: suggested units (read-only), `limit_units` input, `override_units` input — both debounced via the parent's `onSelectionChange` (PUT to `/api/plans/[id]/gear-selections`, sparse: empty clears the row). Override precedence and delta come straight from `GearAllocationResult`.

#### 3. E2E flow

**File**: `tests/gear-units.spec.ts`

**Intent**: Prove the full hybrid path end-to-end.

**Contract**: Define gear (drink + gels + solid food with ratios) → table shows units + delta → set a per-stage limit and observe redistribution → set a direct override and observe it win → reload and confirm persistence → delete an aid station and confirm affected overrides clear.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- E2E flow passes: `npx playwright test tests/gear-units.spec.ts`
- Full suite passes (no regressions): `npx playwright test`

#### Manual Verification:

- Table shows units primary + target/±delta secondary; expanding a row reveals limit + override inputs; a limit triggers visible redistribution; an override wins and persists across reload; deleting a station clears the stale-segment overrides and re-suggests; layout is usable on a mobile viewport.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 6: Docs reconciliation

### Overview

Update the PRD and roadmap to describe the shipped hybrid model, replacing the one-way transform language.

### Changes Required:

#### 1. PRD

**File**: `context/foundation/prd.md`

**Intent**: Rewrite FR-004 and US-06 to the hybrid auto-suggest + per-segment limit/override model with the carb-ratio allocation and sodium-as-third-target scope; bump `version`.

**Contract**: FR-004 reflects: per-plan gear catalog (5 kinds incl. salt caps), carb-ratio-weighted auto-suggestion, per-stage unit limits with redistribution, direct per-stage overrides, round-to-nearest with visible ±delta, fluid/sodium gap-fill. US-06 acceptance criteria updated to match (optional, per-segment adjustability, units-primary display). Increment frontmatter `version` (2 → 3) and `updated`.

#### 2. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Update the S-03 outcome line and at-a-glance row to the hybrid model; refresh `updated`.

**Contract**: S-03 row + slice description reflect "auto-suggest per-segment fueling units from a gear catalog with per-stage limits and overrides" rather than the one-way "gram/ml → unit" transform.

#### 3. change.md status

**File**: `context/changes/gear-profile-units/change.md`

**Intent**: Mark the change planned.

**Contract**: Set `status: planned`, `updated: 2026-06-16`.

### Success Criteria:

#### Automated Verification:

- Linting passes on changed markdown (prettier): `npm run format`

#### Manual Verification:

- FR-004/US-06 and roadmap S-03 read as accurate descriptions of the shipped behavior; no lingering "one-way transform" language; PRD version bumped.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `tests/unit/gear-allocation.test.ts` — ratio split; limit cap + iterative redistribution cascade; override-wins precedence; carb-led fluid gap-fill (carrier) and sodium gap-fill (salt caps); round-to-nearest and delta sign; zero-gear no-op. Includes the worked example (400 g, drink 1 / gel 2 / solid 1, drink capped at 1).
- Confirm `tests/unit/plan-table.test.ts` is unchanged and green (calc-math untouched).

### Integration Tests:

- `tests/integration/gear-flow.test.ts` — zod validation for the three new schemas; RLS ownership for `gear_items` and `gear_segment_selections` (owner CRUD succeeds, non-owner blocked); selection upsert/delete-on-empty behavior.

### Manual Testing Steps:

1. Define gear of each kind; confirm per-kind field visibility and autosave.
2. Generate the table; confirm units-primary + target/±delta and correct deltas.
3. Set a per-stage limit; confirm redistribution across remaining sources.
4. Set a direct override; confirm it overrides the suggestion and persists across reload.
5. Delete an aid station; confirm affected-segment overrides clear and re-suggest.
6. Remove all gear; confirm the table reverts to gram/ml-only.

## Performance Considerations

The allocation runs per segment on every change; for ≤50 aid stations (the NFR ceiling) the redistribution loop is bounded by the small number of carb sources, so it is well within the 1s instant-generation budget. Allocation results are memoized in `PlanEditor` alongside the existing `computePlanTable` memo.

## Migration Notes

Two additive migrations only; no existing-data backfill. Both tables are empty until a runner defines gear, so existing plans render exactly as before (gram/ml-only). FK `on delete cascade` from `plans` ensures gear is cleaned up with the plan.

## References

- Change identity: `context/changes/gear-profile-units/change.md`
- RLS pattern to mirror: `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql:103-135`
- Pure transform (do not modify): `src/lib/plan-table.ts:24`; row type `src/types.ts:97-107`
- Autosave hook: `src/components/hooks/useAutosave.ts:10`; reference form `src/components/plans/RaceSetupForm.tsx:102-126`
- Editor: `src/components/plans/PlanEditor.tsx:16-29`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data model & RLS

#### Automated

- [x] 1.1 Migrations apply cleanly: `npx supabase db reset`
- [x] 1.2 Type checking passes: `npx tsc --noEmit`
- [x] 1.3 Linting passes: `npm run lint`
- [x] 1.4 Integration tests (new-table RLS + zod) pass: `npx playwright test tests/integration/gear-flow.test.ts`

#### Manual

- [x] 1.5 Both tables exist in studio with expected columns, kind check, and four RLS policies each

### Phase 2: Services & API endpoints

#### Automated

- [ ] 2.1 Type checking passes: `npx tsc --noEmit`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Endpoint integration tests (happy path + ownership rejection) pass

#### Manual

- [ ] 2.4 CRUD gear item + upsert selection via dev server; cross-account read blocked

### Phase 3: Pure allocation transform + unit tests

#### Automated

- [ ] 3.1 Allocation golden-number unit tests pass: `npx playwright test tests/unit/gear-allocation.test.ts`
- [ ] 3.2 Type checking passes: `npx tsc --noEmit`
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 `tests/unit/plan-table.test.ts` still passes unchanged

#### Manual

- [ ] 3.5 Worked example (400 g, drink 1 / gel 2 / solid 1, drink capped at 1) matches function output

### Phase 4: Gear catalog UI

#### Automated

- [ ] 4.1 Type checking passes: `npx tsc --noEmit`
- [ ] 4.2 Linting passes: `npm run lint`

#### Manual

- [ ] 4.3 Gear section placed correctly; per-kind fields shown; edits autosave and survive reload; skip leaves gram/ml mode

### Phase 5: Plan table integration + e2e

#### Automated

- [ ] 5.1 Type checking passes: `npx tsc --noEmit`
- [ ] 5.2 Linting passes: `npm run lint`
- [ ] 5.3 E2E flow passes: `npx playwright test tests/gear-units.spec.ts`
- [ ] 5.4 Full suite passes with no regressions: `npx playwright test`

#### Manual

- [ ] 5.5 Units + target/±delta display; expandable panel; limit redistribution; override wins + persists; station delete clears stale overrides; mobile-usable

### Phase 6: Docs reconciliation

#### Automated

- [ ] 6.1 Prettier passes on changed markdown: `npm run format`

#### Manual

- [ ] 6.2 FR-004/US-06 + roadmap S-03 accurately describe shipped behavior; PRD version bumped

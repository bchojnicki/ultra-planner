# GPX Import Implementation Plan

## Overview

Add GPX file upload to a race plan. On upload the app parses the file **in the
browser**, computes total distance (3D) and raw elevation gain/loss (pure
delta-sum), auto-fills the plan's race details, persists the raw GPX values, and
imports every waypoint as an aid station (replace-all, confirmed). The plan
becomes the user-correctable source of truth; a per-metric **calibration delta**
`(corrected − gpx)/gpx` then scales each segment's gain, loss, and distance in
the plan table so segment numbers reconcile to the user-trusted totals.

## Current State Analysis

- Race details (`total_distance_km`, `total_elevation_gain_m`,
  `total_elevation_loss_m`) are entered manually in `RaceSetupForm` and saved via
  `PATCH /api/plans/:id` using `planUpdateSchema` (`src/lib/schemas.ts:11`).
- Aid stations are created **one at a time** (`AidStationManager.tsx:62` →
  `POST /api/plans/:id/aid-stations` → `createAidStation`); there is no bulk path.
- `aid_stations` stores `cumulative_elevation_gain_m` only — **no loss column**
  (`supabase/migrations/20260603132423_create_plans_and_aid_stations.sql`).
- `plan-table.ts` (the product wedge) derives segments from cumulative station
  values and surfaces **gain only** — `PlanTableRow.segment_elevation_gain_m`,
  `PlanTableTotals.elevation_gain_m` (`src/types.ts:195,208`). There is no
  elevation loss anywhere in the derivation today.
- `PlanEditor` is the island root holding `params` + `stations` state; child
  forms own their own state initialized once from props and emit changes upward
  (`src/components/plans/PlanEditor.tsx:23`).
- Runtime: Astro 6 SSR on Cloudflare Workers; API routes export `prerender = false`
  and validate with zod. Tests: Vitest (`*.test.ts` under `tests/unit`,
  `tests/integration`) + Playwright (`*.spec.ts`).

## Desired End State

A runner opens a plan, picks a GPX file, and the race details (distance, gain,
loss) fill automatically; if the GPX has waypoints, the aid-station list is
replaced with the imported stations (each labelled with its waypoint name). The
runner can correct any of the three totals; the plan table's per-segment gain,
loss, and distance are scaled by the resulting calibration delta. Plans without
GPX (manual entry) behave exactly as before, now with an optional per-station
loss field and a loss column in the table.

Verify: upload a fixture GPX → race details populate, stations appear, plan
table renders gain **and** loss per segment; edit a total → segment values
rescale; a manual-only plan still works with factor = 1 (no scaling).

### Key Discoveries:

- Client-side parse sidesteps the Workers GPX-parser problem entirely — only
  small computed numbers are POSTed, never the raw file (frame research item #4).
- `gpx_*` raw values must NOT be editable via the autosave PATCH — they are the
  delta denominator and are set only at import. Keep them out of
  `planUpdateSchema`; use a dedicated `gpxImportSchema`.
- Child forms (`RaceSetupForm`, `AidStationManager`) initialize state once from
  props, so an import must force them to re-read fresh values (remount key).
- `computePlanTable` early-returns `missing_params` unless
  `total_elevation_gain_m > 0` (`plan-table.ts:26`) — calibration must not break
  this guard.

## What We're NOT Doing

- Not uploading or storing the raw GPX file (no Supabase Storage bucket); only
  the computed raw values are persisted.
- Not changing the moving-time model beyond feeding it calibrated gain — descent
  (loss) does **not** add or remove moving time; the Naismith gain-only weight
  stays (loss is displayed, not time-weighted).
- Not adding GPX import history/versioning — one GPX per plan, latest wins.
- Not server-side parsing, smoothing/threshold filtering, or 2D distance.
- Not supporting routes/`<rte>` elements — only `<trk>`/`<trkpt>` tracks and
  `<wpt>` waypoints.

## Implementation Approach

Parse and compute in a pure browser module, hand the result to a single
replace-all import endpoint, store raw GPX values alongside the corrected
totals, and derive the calibration factors on read inside `computePlanTable`.
Build bottom-up: schema/types first, then the pure parse/compute module, then
the import endpoint, then the calibration in the table, then the UI that ties
them together.

**Calibration model** (derived on read, never stored):
for each metric m ∈ {distance, gain, loss}, `factor_m = plan.total_m / plan.gpx_m`
when `plan.gpx_m` is non-null and `> 0`, else `1`. Each segment's raw value
(differenced from GPX-derived cumulative station values) is multiplied by
`factor_m`. With factor = 1, manual plans are unchanged.

## Critical Implementation Details

- **State sequencing on import** — `RaceSetupForm` and `AidStationManager`
  seed state from props once. After a successful import, `PlanEditor` must
  update its authoritative `params`/`stations` AND bump a `key` on those two
  children so they remount and re-read the imported values. Updating
  `PlanEditor` state alone will not refresh the child forms' inputs.
- **Replace-all ordering** — the import endpoint must update the plan row and
  replace stations in one request: set plan fields → delete existing stations
  for the plan → insert the new set. Supabase has no client transaction; on a
  mid-sequence failure, return an error and let the user re-import (idempotent).
- **Calibration guard** — apply `factor` to segment values, not to the
  `missing_params` check; the check still reads the raw corrected totals.

## Phase 1: Schema & Types Foundation

### Overview

Add persistence for raw GPX values and per-station elevation loss, and mirror
the columns in the TypeScript types and validation schemas.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_gpx_import_columns.sql`

**Intent**: Add the three nullable raw-GPX columns to `plans` and a non-null
defaulted cumulative-loss column to `aid_stations`, so imports have a home and
the calibration delta has a denominator. No RLS changes (ownership already flows
through existing policies).

**Contract**: `alter table plans add column gpx_distance_km numeric,
add column gpx_elevation_gain_m numeric, add column gpx_elevation_loss_m numeric`
(all nullable, NULL = no GPX imported). `alter table aid_stations add column
cumulative_elevation_loss_m numeric not null default 0`. Follow the naming/units
conventions in the existing migrations (numeric, meters/km).

#### 2. Entity & DTO types

**File**: `src/types.ts`

**Intent**: Mirror the new columns column-for-column so the typed Supabase client
stays accurate.

**Contract**: `Plan` gains `gpx_distance_km: number | null`,
`gpx_elevation_gain_m: number | null`, `gpx_elevation_loss_m: number | null`.
`PlanInsert`/`PlanUpdate` inherit them as optional. `AidStation` gains
`cumulative_elevation_gain_m`'s sibling `cumulative_elevation_loss_m: number`;
add it to the `AidStationInsert` optional pick (DB default 0). `PlanTableRow`
gains `segment_elevation_loss_m: number`; `PlanTableTotals` gains
`elevation_loss_m: number` (consumed in Phase 4).

#### 3. Validation schemas

**File**: `src/lib/schemas.ts`

**Intent**: Add an import schema for the dedicated endpoint and let manual
station create carry loss. Keep `gpx_*` out of `planUpdateSchema` so autosave
can never overwrite the delta denominator.

**Contract**: New `gpxImportSchema` (strictObject): the three `gpx_*` values
(non-negative), the three corrected `total_*` values (non-negative), and
`stations: z.array(...)` where each item is `{ cumulative_distance_km,
cumulative_elevation_gain_m, cumulative_elevation_loss_m, notes?: string|null }`
(all non-negative). Add `cumulative_elevation_loss_m: nonNegative.optional()` to
`aidStationCreateSchema`. Leave `planUpdateSchema` unchanged.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` (or `npx supabase migration up`)
- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- New columns exist with correct types/defaults in the local DB
- Existing plans/stations still load (nullable/defaulted columns don't break reads)

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: GPX Parse + Compute Module

### Overview

A pure, browser-side module that turns GPX XML into computed totals and
projected stations. Math functions are separated so they unit-test in Node
without a DOM.

### Changes Required:

#### 1. GPX module

**File**: `src/lib/gpx.ts`

**Intent**: Provide the parse + compute primitives the upload UI calls.
Keep the coordinate math pure (array in → numbers out) and isolate the
DOM-dependent XML extraction in one thin function.

**Contract**: Exports —
`parseGpx(xml: string): { track: GpxPoint[]; waypoints: GpxWaypoint[] }` using
`DOMParser` (browser); `GpxPoint = { lat; lon; ele }`,
`GpxWaypoint = GpxPoint & { name: string }`.
`distance3dKm(track): number` — sum of per-leg `sqrt(haversine2d² + Δele²)`, → km.
`elevationGainLoss(track): { gain_m; loss_m }` — pure delta-sum (gain = Σ positive
Δele, loss = Σ |negative Δele|), no threshold.
`projectWaypointsToStations(track, waypoints): StationImport[]` — for each
waypoint, find the nearest track point (2D haversine), take the cumulative
distance/gain/loss along the track up to that index; return sorted by cumulative
distance, `notes = waypoint.name`. `StationImport = { cumulative_distance_km;
cumulative_elevation_gain_m; cumulative_elevation_loss_m; notes }`.

#### 2. Unit tests

**File**: `tests/unit/gpx.test.ts`

**Intent**: Lock the math against known inputs.

**Contract**: Cover `distance3dKm` (flat vs sloped legs), `elevationGainLoss`
(monotonic climb, descent, noisy zig-zag → exact delta-sum), and
`projectWaypointsToStations` (waypoint on-track, off-track snaps to nearest,
ordering by cumulative distance). Include one small inline GPX string parsed via
`parseGpx` (Vitest default env provides DOM; if not, add `// @vitest-environment
jsdom`).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:integration` (vitest run) or `npx vitest run tests/unit/gpx.test.ts`
- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Parsing the real sample GPX yields plausible distance/gain/loss and the
  expected number of stations with correct names

---

## Phase 3: Import Endpoint + Service

### Overview

A single replace-all endpoint that persists the plan's raw + corrected values
and swaps in the imported stations.

### Changes Required:

#### 1. Aid-station service helpers

**File**: `src/lib/services/aid-stations.ts`

**Intent**: Add the bulk/replace primitives the import needs.

**Contract**: `deleteAidStationsForPlan(client, planId): Promise<void>` (delete
where `plan_id = planId`); `bulkInsertAidStations(client, planId, rows):
Promise<AidStation[]>` (insert array with `plan_id` injected). Throw on error,
matching the existing module style.

#### 2. Import endpoint

**File**: `src/pages/api/plans/[id]/gpx-import.ts`

**Intent**: Validate the import payload, write plan fields (gpx + corrected
totals), then replace the station set. Mirror the auth/RLS/error pattern in
`src/pages/api/plans/[id]/aid-stations.ts`.

**Contract**: `export const prerender = false; export const POST`. Auth via
`context.locals.user`; client via `createClient`. Validate body with
`gpxImportSchema`. Sequence: `updatePlan(client, id, { gpx_*, total_* })` →
`deleteAidStationsForPlan(client, id)` → `bulkInsertAidStations(client, id,
stations)`. Map RLS `42501` → 403, `PGRST116` → 404. Return
`{ plan, stations }` at 200.

### Success Criteria:

#### Automated Verification:

- Integration test passes: `npx vitest run tests/integration/gpx-import-flow.test.ts`
- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Importing replaces existing stations (no duplicates) and sets plan values
- Importing into another user's plan is rejected (403); unknown plan → 404

**Implementation Note**: Pause for manual confirmation after automated checks pass.

---

## Phase 4: Calibration in Plan Table

### Overview

Add elevation loss through the derivation and apply the per-metric calibration
factor so segment gain/loss/distance reconcile to the corrected totals.

### Changes Required:

#### 1. Calibrated, loss-aware computation

**File**: `src/lib/plan-table.ts`

**Intent**: Extend `Point`/`Segment` with loss, compute per-metric factors from
`plan.total_* / plan.gpx_*` (1 when gpx is null/0), and scale each segment's
distance, gain, and loss. Feed calibrated gain into the existing Naismith weight.

**Contract**: `Point` gains `elevation_loss_m`; intermediate points read
`station.cumulative_elevation_loss_m`, the finish point reads
`plan.total_elevation_loss_m`. Per segment: `gain = factor_gain · max(0, Δgain)`,
`loss = factor_loss · max(0, Δloss)`, `distance = factor_dist · Δdistance`;
`weight = distance + SEGMENT_ELEVATION_WEIGHT_K · gain`. Each `PlanTableRow` adds
`segment_elevation_loss_m`; `PlanTableTotals` adds `elevation_loss_m`
(Σ segment loss). The `missing_params` guard is unchanged.

#### 2. Table UI

**File**: `src/components/plans/PlanTable.tsx`

**Intent**: Render the loss column alongside gain in rows and totals.

**Contract**: Add an elevation-loss cell per row and a totals cell; match the
existing gain column's formatting/rounding.

#### 3. Unit tests

**File**: `tests/unit/plan-table.test.ts`

**Intent**: Cover loss derivation and calibration scaling; protect existing behavior.

**Contract**: Add cases — segment loss derived from cumulative loss; factor = 1
when `gpx_*` null (existing assertions hold); factor scales segment gain/loss/
distance and totals reconcile to corrected totals; calibrated gain changes the
weight distribution as expected.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run tests/unit/plan-table.test.ts`
- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Plan table shows gain and loss per segment; totals match corrected plan values
- A manual (no-GPX) plan renders identically to before plus a loss column of 0s

---

## Phase 5: Upload UI + Integration

### Overview

Wire the file picker, client parse/compute, confirm-overwrite, import call, and
state refresh; add the manual per-station loss field.

### Changes Required:

#### 1. GPX upload control

**File**: `src/components/plans/RaceSetupForm.tsx` (or a new
`src/components/plans/GpxImport.tsx` rendered inside it)

**Intent**: Let the user pick a `.gpx` file, parse/compute client-side, confirm
before overwriting existing values/stations, POST the import, and surface
validation errors inline.

**Contract**: File input (`accept=".gpx"`) + "Import GPX" button + status/error
text. On select: read text, `parseGpx` + compute; reject non-GPX / parse failure
/ oversize with an inline message; if the plan already has non-default totals or
existing stations, `window.confirm` before applying. POST to
`/api/plans/:id/gpx-import` with `{ gpx_*, total_* , stations }`. On success,
emit the returned `{ plan, stations }` upward via a new `onGpxImported` callback;
refresh this form's own fields from the imported plan.

#### 2. Manual loss field

**File**: `src/components/plans/AidStationManager.tsx`

**Intent**: Add an optional cumulative-loss input so manual plans get full
gain+loss segments.

**Contract**: New "Cumulative elevation loss (m)" number input (default empty →
0); include `cumulative_elevation_loss_m` in the POST body; display it in the
station row next to gain.

#### 3. Editor state refresh

**File**: `src/components/plans/PlanEditor.tsx`

**Intent**: Make the editor own authoritative plan+stations and remount the
child forms after import so they re-read imported values.

**Contract**: Hold `params`/`stations` as today; add `onGpxImported(plan,
stations)` that sets both and bumps an `importKey`. Pass `importKey` as `key` to
`RaceSetupForm` and `AidStationManager` (and pass current `params`/`stations` as
their seed props) so they remount with fresh data. Stale gear selections are
already pruned by the existing `onStationsChange` logic — route the imported
stations through it.

#### 4. End-to-end test

**File**: `tests/gpx-import.spec.ts`

**Intent**: Prove the flow in a browser.

**Contract**: Sign in (reuse existing helpers), open a plan, upload a fixture
`.gpx`, assert race-detail inputs populate and station rows appear with names;
assert the plan table shows loss. Add the fixture under `tests/fixtures/`.

### Success Criteria:

#### Automated Verification:

- E2E passes: `npx playwright test tests/gpx-import.spec.ts`
- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Upload populates race details + stations; confirm dialog appears when
  overwriting; bad file shows a clear error
- Editing a corrected total live-rescales the plan table segments
- Manual loss field persists and shows in the table

**Implementation Note**: Pause for manual confirmation after automated checks pass.

---

## Testing Strategy

### Unit Tests:

- `gpx.ts`: 3D distance, pure delta-sum gain/loss, waypoint projection + ordering
- `plan-table.ts`: loss derivation, calibration factor (incl. factor = 1), totals reconciliation

### Integration Tests:

- `gpx-import` endpoint: replace-all semantics, ownership (403/404), plan fields set

### Manual Testing Steps:

1. Upload the real sample GPX → verify distance/gain/loss + station names/order
2. Correct a total → verify segment values rescale in the table
3. Upload again over existing stations → verify confirm + replace (no duplicates)
4. Add a manual station with a loss value → verify it shows in the table
5. Upload a non-GPX / corrupt file → verify inline error, no data change

## Performance Considerations

Parsing happens client-side on a single file; typical race GPX (a few thousand
points) is trivial in-browser. Nearest-point projection is O(waypoints ×
trackpoints) — acceptable for realistic sizes; revisit only if very large tracks
appear.

## Migration Notes

New columns are additive: `gpx_*` are nullable (existing plans read as NULL →
calibration factor 1), and `cumulative_elevation_loss_m` defaults 0 on existing
stations. No backfill required. No rollback data loss beyond the new columns.

## References

- Frame brief: `context/changes/gpx-import/frame.md`
- Schema baseline: `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql`
- Endpoint pattern: `src/pages/api/plans/[id]/aid-stations.ts`, `src/pages/api/plans/[id].ts`
- Derivation to extend: `src/lib/plan-table.ts`
- Editor integration: `src/components/plans/PlanEditor.tsx:23`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & Types Foundation

#### Automated

- [x] 1.1 Migration applies cleanly (`npx supabase db reset` / `migration up`) — 1166e95
- [x] 1.2 Type checking passes (`npx astro sync && npm run build`) — 1166e95
- [x] 1.3 Linting passes (`npm run lint`) — 1166e95

#### Manual

- [x] 1.4 New columns exist with correct types/defaults in local DB — 1166e95
- [x] 1.5 Existing plans/stations still load — 1166e95

### Phase 2: GPX Parse + Compute Module

#### Automated

- [x] 2.1 Unit tests pass (`npx vitest run tests/unit/gpx.test.ts`) — fc32999
- [x] 2.2 Type checking passes (`npx astro sync && npm run build`) — fc32999
- [x] 2.3 Linting passes (`npm run lint`) — fc32999

#### Manual

- [x] 2.4 Real sample GPX yields plausible totals + expected stations/names — fc32999

### Phase 3: Import Endpoint + Service

#### Automated

- [x] 3.1 Integration test passes (`npx vitest run tests/integration/gpx-import-flow.test.ts`) — a7c9628
- [x] 3.2 Type checking passes (`npx astro sync && npm run build`) — a7c9628
- [x] 3.3 Linting passes (`npm run lint`) — a7c9628

#### Manual

- [ ] 3.4 Import replaces stations + sets plan values; 403/404 paths verified

### Phase 4: Calibration in Plan Table

#### Automated

- [x] 4.1 Unit tests pass (`npx vitest run tests/unit/plan-table.test.ts`)
- [x] 4.2 Type checking passes (`npx astro sync && npm run build`)
- [x] 4.3 Linting passes (`npm run lint`)

#### Manual

- [x] 4.4 Table shows gain + loss per segment; totals match corrected values
- [x] 4.5 Manual (no-GPX) plan unchanged plus 0-loss column

### Phase 5: Upload UI + Integration

#### Automated

- [ ] 5.1 E2E passes (`npx playwright test tests/gpx-import.spec.ts`)
- [ ] 5.2 Type checking passes (`npx astro sync && npm run build`)
- [ ] 5.3 Linting passes (`npm run lint`)

#### Manual

- [ ] 5.4 Upload populates details + stations; confirm-overwrite works; bad file errors
- [ ] 5.5 Editing a total live-rescales segments
- [ ] 5.6 Manual loss field persists and shows in the table

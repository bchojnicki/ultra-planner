# Edit Aid Stations Implementation Plan

## Overview

Add in-place editing of aid stations. Today a station can only be **added** or
**deleted** — there is no way to correct a mistyped value or enrich a station,
which matters most for GPX-imported stations that arrive "bare" (distance /
elevation / name only, no facilities, time, or crew notes). This plan wires the
already-written `updateAidStation` service function to a new `PATCH
/api/aid-stations/[id]` endpoint and adds an inline-expand editor (all fields,
debounced autosave) to `AidStationManager`. Implements PRD US-10 / FR-007.

## Current State Analysis

- `AidStationManager.tsx` is a top **add-form** plus a **read-only list** where
  each row has a Delete button (`src/components/plans/AidStationManager.tsx`). No
  edit affordance exists.
- `updateAidStation(client, id, patch: AidStationUpdate)` already exists and is
  **unwired** (`src/lib/services/aid-stations.ts:26`).
- `AidStationUpdate` type already exists
  (`src/types.ts:102` — `Partial<Omit<AidStation, "id"|"plan_id"|"created_at"|"updated_at">>`).
- `src/pages/api/aid-stations/[id].ts` exposes **DELETE only** — the auth/client
  guard pattern there is the template for the new PATCH.
- The POST route `src/pages/api/plans/[id]/aid-stations.ts` shows the established
  `42501 → 403` Supabase-error mapping for station writes.
- `aidStationCreateSchema` (`src/lib/schemas.ts:26`) is the basis for the update
  schema; an update schema is all-optional (partial patch).
- `computePlanTable` filters stations to `0 < cumulative_distance_km <
  distCal.finish` and skips zero-length legs — **out-of-bounds stations are
  silently dropped from the table**, not errored. This is why edit-time distance
  validation is a deliberate decision rather than a crash-prevention necessity.
- `PlanEditor.onStationsChange(next)` already recomputes the table and prunes
  stale gear selections when the station set changes
  (`src/components/plans/PlanEditor.tsx`). Edited stations must flow through it.
- Autosave convention: `useAutosave` + a passive status line ("Saving…/Saved/Save
  failed — will retry on next change") in `RaceSetupForm.tsx`; `PlanEditor` uses a
  debounced PUT for gear selections. Inline-expand convention: `PlanTable.tsx`
  uses an `expanded: Set<number>` toggle for its per-row gear panel.

## Desired End State

A runner viewing a plan can click **Edit** on any aid station, the row expands
in place into editable fields (cumulative distance, gain, loss, time, the six
facility checkboxes, crew notes), and changes autosave as they type. Editing a
GPX-imported bare station to add facilities/time/notes is the primary use. The
plan table recomputes live; if the runner changes a station's distance the list
re-sorts when the editor closes. An invalid distance (≤ 0, ≥ total race distance,
or duplicating another station) shows an inline error and is not saved until
corrected.

Verify: open a plan with stations → Edit one → change notes/facilities, see
autosave + the table update; change distance to a valid new value → on closing
the editor the row re-sorts; set distance to 0 or a duplicate → inline error,
no save; reload → edits persisted.

### Key Discoveries:

- `updateAidStation` + `AidStationUpdate` already exist — Phase 1 is schema +
  endpoint wiring, no new service code.
- The DELETE route returns 204 idempotently (RLS hides non-owned rows on delete);
  but `updateAidStation` uses `.single()`, so a non-owned/absent id surfaces as
  PostgREST `PGRST116` → map to 404, and a WITH CHECK violation as `42501` → 403.
- `AidStationManager` does not currently know the plan's total distance; the
  `< total` bound check needs `total_distance_km` passed in from `PlanEditor`.
- Uniqueness/bounds data is local: `AidStationManager` already holds the full
  station list, so duplicate/inbounds checks need no extra fetch.

## What We're NOT Doing

- Not adding bounds/uniqueness validation to the **add** path — this change
  touches the edit path only (add behavior is unchanged; a follow-up could unify).
- Not special-casing GPX-imported stations — edit is uniform for all stations.
- Not adding an explicit Save/Cancel button — edits autosave (a Done/collapse
  control closes the editor; there is no separate commit step).
- Not changing the plan-table derivation, the calibration, or any GPX code.
- Not editing `plan_id` or identity fields.

## Implementation Approach

Backend first (schema + endpoint, independently testable), then the UI. The UI
extends the existing `AidStationManager` list with a per-row expand editor that
mirrors the add-form fields, debounces a `PATCH` per change (like the gear-
selection autosave), validates the distance locally before persisting, and emits
the updated station set through `PlanEditor.onStationsChange` so the table
recomputes and stale gear selections are pruned — the same path add/delete use.

## Critical Implementation Details

- **State sequencing on distance edit** — re-sorting the list on every keystroke
  makes the edited row jump out from under the cursor. Keep the row in its
  original position while its editor is open; re-sort (and emit `onStationsChange`)
  only when the editor collapses. Local field state updates immediately so the
  inputs stay responsive; the debounced PATCH and the parent emit are what carry
  the change outward.
- **Validation gates the save, not the keystroke** — the runner can type freely;
  the debounced PATCH is withheld while the distance is invalid (≤ 0, ≥
  `total_distance_km`, or equal to another station's distance), and an inline
  error shows. Non-distance fields never block.

## Phase 1: Update schema + PATCH endpoint

### Overview

Add the validation schema and the endpoint that wires the existing
`updateAidStation`, with ownership-scoped error mapping.

### Changes Required:

#### 1. Update schema

**File**: `src/lib/schemas.ts`

**Intent**: Validate an aid-station edit payload — every field optional so the
client can PATCH just what changed.

**Contract**: New `aidStationUpdateSchema` (`z.strictObject`) with every field
from `aidStationCreateSchema` made optional (including the two cumulative
measurements): `cumulative_distance_km`, `cumulative_elevation_gain_m`,
`cumulative_elevation_loss_m`, `time_spent_min` (all `nonNegative.optional()`),
the six boolean flags optional, `notes` nullable-optional. Export
`AidStationUpdateInput = z.infer<...>`. Reject unknown keys (strictObject), as the
sibling schemas do.

#### 2. PATCH endpoint

**File**: `src/pages/api/aid-stations/[id].ts`

**Intent**: Expose editing by wiring `updateAidStation`, mirroring the auth/client
guards already in this file's DELETE handler and the `42501 → 403` mapping from
the aid-stations POST route.

**Contract**: Add `export const PATCH: APIRoute`. Auth via `context.locals.user`
(401); client via `createClient` (500); `id` presence (400). Parse body with
`aidStationUpdateSchema` (400 on failure); empty patch → return 200 no-op (mirror
the plan PATCH route). Call `updateAidStation(supabase, id, parsed.data)`; map
`42501 → 403`, `PGRST116 → 404`, rethrow otherwise. Return the updated station as
JSON at 200.

#### 3. Integration test

**File**: `tests/integration/aid-station-edit.test.ts`

**Intent**: Prove the update path validates, persists partial edits, and is
owner-scoped by RLS — mirroring `tests/integration/gpx-import-flow.test.ts`.

**Contract**: Schema accept/reject cases (valid partial patch; rejects negative,
unknown key). Service-level RLS cases using the local-Supabase harness: owner can
`updateAidStation` its own station (partial patch persists, other fields
untouched); runner B updating runner A's station rejects with `PGRST116` (the 404
path). Reuse the `assertLocal` + two-user setup from the existing integration
tests.

### Success Criteria:

#### Automated Verification:

- Integration test passes: `npx vitest run tests/integration/aid-station-edit.test.ts`
- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `PATCH /api/aid-stations/:id` with a partial body updates only those fields; a non-owned id returns 404

**Implementation Note**: After automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Inline-edit UI + validation

### Overview

Add a per-row inline-expand editor to `AidStationManager` (all fields, debounced
autosave, distance validation, re-sort on collapse) and wire `PlanEditor` to feed
it the plan total distance and route edits through `onStationsChange`.

### Changes Required:

#### 1. Editor state + autosave + validation in the manager

**File**: `src/components/plans/AidStationManager.tsx`

**Intent**: Let each station row toggle into an inline editor mirroring the add-
form fields; persist changes via a debounced PATCH; validate the distance before
persisting; re-sort the list only when the editor closes.

**Contract**: Accept a new prop `totalDistanceKm: number` (for the upper bound).
Track which station id is being edited and its working field values (local state,
seeded from the station). Each row gains an **Edit** toggle that expands an editor
with inputs for cumulative distance / gain / loss / time, the six facility
checkboxes, and notes — reusing the existing `inputCls` / field markup. On field
change: update local state immediately and schedule a debounced
`PATCH /api/aid-stations/${id}` with the changed fields. **Distance validation**:
when the distance is ≤ 0, ≥ `totalDistanceKm`, or equal to another station's
`cumulative_distance_km`, show an inline error and withhold the PATCH until valid;
other fields are never blocked. On a successful PATCH, update the row from the
returned station. On editor **collapse** (Done/toggle-off or blur out of the
editor): re-sort the list by cumulative distance and emit the new list via
`onStationsChange`. Surface a passive save status consistent with the app
("Saving…/Saved/Save failed — will retry on next change"). Keep the existing add
and delete behavior intact.

#### 2. Wire the editor through the editor root

**File**: `src/components/plans/PlanEditor.tsx`

**Intent**: Give the manager the plan total distance for bound-checking; edits
already have a home via `onStationsChange`.

**Contract**: Pass `totalDistanceKm={params.total_distance_km}` to
`AidStationManager`. No new handler needed — the manager emits edited/re-sorted
stations through the existing `onStationsChange`, which recomputes the table and
prunes stale gear selections.

#### 3. End-to-end test

**File**: `tests/aid-station-edit.spec.ts`

**Intent**: Prove the edit flow in a browser, gated like the other e2e specs.

**Contract**: `test.skip(!process.env.TEST_EMAIL, …)`; `test.slow()` for cold-start.
Sign in (reuse `signInViaOtp`), create a plan, add a station, then: open its
editor, change crew notes + a facility, assert the value persists (reload or the
returned row) and the station row reflects it; change distance to a valid value
and confirm the list re-orders after closing the editor; set distance to 0 and
assert an inline error appears and is not persisted.

### Success Criteria:

#### Automated Verification:

- E2E passes: `npx playwright test tests/aid-station-edit.spec.ts`
- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Edit a station's notes/facilities → autosaves, table updates, persists on reload
- Editing a GPX-imported bare station adds facilities/time/notes successfully
- Changing distance re-sorts the row only after the editor closes (no mid-typing jump)
- Distance set to 0 / ≥ total / a duplicate shows an inline error and does not save

**Implementation Note**: After automated checks pass, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- (None new required — the schema is exercised by the integration test; no pure
  logic is added beyond validation, which the e2e covers behaviorally.)

### Integration Tests:

- `aid-station-edit`: schema accept/reject; `updateAidStation` partial-update
  persists; RLS ownership (non-owner update → PGRST116/404).

### Manual Testing Steps:

1. Import or add stations; click Edit on one → fields populate from the station.
2. Change notes + a facility → see Saving…/Saved; reload → persisted.
3. Change distance to a valid new value → row re-sorts after closing the editor.
4. Set distance to 0, to ≥ total, and to a duplicate → inline error, no save each time.
5. Edit a GPX-imported bare station to add time + crew notes → reflected in the table.

## Performance Considerations

Debounced PATCH per edit (same model as gear-selection autosave); a plan has at
most a handful of stations, so re-sort + recompute on collapse is trivial.

## Migration Notes

None — no schema/DB changes. `cumulative_elevation_loss_m` already exists from
`gpx-import`.

## References

- Frame brief: `context/changes/edit-aid-stations/frame.md`
- Service: `src/lib/services/aid-stations.ts:26` (`updateAidStation`)
- Endpoint template: `src/pages/api/aid-stations/[id].ts` (DELETE), `src/pages/api/plans/[id]/aid-stations.ts` (42501→403)
- Schema basis: `src/lib/schemas.ts:26` (`aidStationCreateSchema`)
- UI to extend: `src/components/plans/AidStationManager.tsx`; inline-expand pattern in `src/components/plans/PlanTable.tsx`; autosave in `src/components/plans/RaceSetupForm.tsx`
- Editor wiring: `src/components/plans/PlanEditor.tsx` (`onStationsChange`)
- PRD: US-10 / FR-007 (v5)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Update schema + PATCH endpoint

#### Automated

- [x] 1.1 Integration test passes (`npx vitest run tests/integration/aid-station-edit.test.ts`) — afb403f
- [x] 1.2 Type checking passes (`npx astro sync && npm run build`) — afb403f
- [x] 1.3 Linting passes (`npm run lint`) — afb403f

#### Manual

- [x] 1.4 PATCH with a partial body updates only those fields; non-owned id → 404 — afb403f

### Phase 2: Inline-edit UI + validation

#### Automated

- [x] 2.1 E2E passes (`npx playwright test tests/aid-station-edit.spec.ts`)
- [x] 2.2 Type checking passes (`npx astro sync && npm run build`)
- [x] 2.3 Linting passes (`npm run lint`)

#### Manual

- [x] 2.4 Edit notes/facilities → autosaves, table updates, persists on reload
- [x] 2.5 Editing a GPX-imported bare station adds facilities/time/notes
- [x] 2.6 Distance edit re-sorts the row only after the editor closes (no mid-typing jump)
- [x] 2.7 Distance 0 / ≥ total / duplicate shows an inline error and does not save

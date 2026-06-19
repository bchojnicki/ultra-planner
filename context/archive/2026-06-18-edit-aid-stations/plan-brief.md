# Edit Aid Stations — Plan Brief

> Full plan: `context/changes/edit-aid-stations/plan.md`
> Frame brief: `context/changes/edit-aid-stations/frame.md`

## What & Why

Add in-place editing of aid stations. There is currently no edit path — only add
and delete — so a runner cannot correct a mistyped value or enrich a GPX-imported
station, which lands "bare" (distance/elevation/name only, no facilities, time, or
crew notes). Edit becomes the way to enrich those rather than delete-and-re-add.
Implements PRD US-10 / FR-007.

## Starting Point

`AidStationManager` is a top add-form + a read-only list with per-row delete. The
service function `updateAidStation` and the `AidStationUpdate` type already exist
but are unwired; `/api/aid-stations/[id]` exposes DELETE only. The plan table
already recomputes and prunes stale gear selections via `PlanEditor.onStationsChange`.

## Desired End State

Click **Edit** on any station → the row expands in place into editable fields
(distance, gain, loss, time, six facility checkboxes, notes); changes autosave as
you type; the table updates live. Changing distance re-sorts the row when the
editor closes (no mid-typing jump). An invalid distance (≤ 0, ≥ total, or a
duplicate) shows an inline error and isn't saved until corrected.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Edit affordance | Inline-expand row | Matches PlanTable's gear-panel expand; no new overlay | Frame |
| Field scope | All fields | Full parity with create; loss column already exists | Frame |
| GPX handling | Uniform edit | Imported & manual stations are the same entity | Frame |
| Save model | Autosave on change (debounced) | Matches app-wide silent-autosave | Frame |
| Endpoint | New `PATCH /api/aid-stations/[id]` | Wires existing `updateAidStation`; mirrors DELETE route | Frame |
| Re-sort timing | On editor collapse/blur | Avoids the row jumping under the cursor mid-edit | Plan |
| Invalid distance | Inline validation, block save | Prevents a station silently vanishing from the table | Plan |

## Scope

**In scope:** `aidStationUpdateSchema`; `PATCH /api/aid-stations/[id]`; inline-expand
editor in `AidStationManager` (all fields, debounced autosave, distance validation,
re-sort on collapse); `PlanEditor` passes total distance; integration + e2e tests.

**Out of scope:** bounds/uniqueness validation on the **add** path (edit only);
GPX-specific edit affordances; explicit Save/Cancel button; any plan-table /
calibration / GPX changes; editing identity fields.

## Architecture / Approach

Backend first: an all-optional update schema + a PATCH handler wiring the existing
`updateAidStation` (auth/RLS guards mirrored from the DELETE handler; `42501→403`,
`PGRST116→404`). Then UI: each list row toggles an inline editor; field changes
update local state immediately and schedule a debounced PATCH; the distance is
validated locally (against `totalDistanceKm` from `PlanEditor` and the sibling
stations) before persisting; on collapse the list re-sorts and emits via the
existing `onStationsChange`, so the table recomputes and stale gear selections prune.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Update schema + PATCH endpoint | Editing works at the API layer, owner-scoped | Error-mapping parity (404 vs 403) |
| 2. Inline-edit UI + validation | The full in-app edit experience | Autosave + re-sort interaction; validation withholding the PATCH |

**Prerequisites:** Branch `edit-aid-stations` is stacked on `gpx-import` (needs its
`cumulative_elevation_loss_m` column); rebase onto `main` once PR #10 merges.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Autosave + validation: the debounced PATCH must be withheld while the distance is
  invalid, without blocking the other fields — the one piece of real interaction logic.
- Re-sort-on-collapse keeps the edited row stable, but the list order is briefly
  stale while the editor is open (accepted tradeoff).
- e2e is gated behind `TEST_EMAIL` (skips in CI), like the other flow specs.

## Success Criteria (Summary)

- A runner can edit any field of an existing station and the change persists + the table updates.
- A GPX-imported bare station can be enriched with facilities, time, and crew notes.
- An invalid distance is caught inline and never silently drops the station from the table.

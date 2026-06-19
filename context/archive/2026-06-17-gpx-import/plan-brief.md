# GPX Import — Plan Brief

> Full plan: `context/changes/gpx-import/plan.md`
> Frame brief: `context/changes/gpx-import/frame.md`

## What & Why

Build a calibration-aware GPX ingest pipeline for a race plan: parse the file in
the browser, auto-fill distance/elevation, import waypoints as aid stations, and
persist the raw GPX values so a per-metric correction delta `(corrected − gpx)/gpx`
can scale segment gain/loss/distance. This is the v2 feature parked in the PRD as
"the primary MVP-complexity driver" — now de-risked: it's an *N*-waypoint
importer with calibration, not a fixed "8 waypoints → 8 stations" reader.

## Starting Point

Race details and aid stations are entered manually today (`RaceSetupForm`,
`AidStationManager` → autosave PATCH / one-station-per-POST). The plan table
(`plan-table.ts`) derives segments from cumulative station values and surfaces
**gain only** — there is no elevation loss anywhere, and no bulk-create path.

## Desired End State

Picking a GPX file fills the race details, replaces the station list with the
file's waypoints (named, distance-ordered), and renders a plan table with gain
**and** loss per segment. Correcting any total live-rescales the segments via the
calibration delta. Manual (no-GPX) plans work as before, now with an optional
per-station loss field and a loss column (factor = 1, no scaling).

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Station count | Arbitrary N (not 8) | Race-dependent; 0 → manual fallback | Frame |
| Elevation accuracy | Calibration delta, not smoothing | User pins truth; back-propagate to segments | Frame |
| Delta scope | Full pipeline incl. segment scaling | Ship end-to-end in one change | Plan |
| Parse location | Client-side (browser island) | Sidesteps Workers GPX-lib problem; no file upload | Plan |
| Raw GPX storage | 3 nullable columns on `plans` | Simplest; delta denominator co-located | Plan |
| Distance method | 3D slope distance | User choice (delta corrects vs official) | Plan |
| Raw gain/loss | Pure delta-sum (no threshold) | Simple/deterministic; delta corrects it | Plan |
| Import mode | Replace-all, with confirm | GPX = clean source of truth, no dup ambiguity | Plan |
| Manual loss | Optional field in manual entry | Consistent gain+loss segments for all plans | Plan |
| Bad input/overwrite | Validate + confirm overwrite | Safe; no silent clobber | Plan |

## Scope

**In scope:** client GPX parse/compute module; migration (raw-GPX cols on
`plans`, cumulative-loss on `aid_stations`); replace-all import endpoint + bulk
service; calibration + loss in `plan-table.ts` + table UI; upload UI + manual
loss field; unit/integration/e2e tests.

**Out of scope:** storing the raw GPX file; server-side parsing; 2D distance or
smoothing; loss affecting moving-time (gain-only Naismith weight stays); import
history; `<rte>` routes.

## Architecture / Approach

Browser parses GPX (`DOMParser`) → pure math (3D distance, delta-sum gain/loss,
waypoint→track projection) → `POST /api/plans/:id/gpx-import` writes plan
`gpx_*` + corrected totals and replaces stations → `computePlanTable` derives
per-metric factors (`total/gpx`, 1 when no GPX) and scales each segment.
`PlanEditor` remounts the child forms on import to refresh their state.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & types | gpx cols + station loss col, types, schemas | Migration/type drift across `types.ts` + `Database` |
| 2. Parse + compute | pure `src/lib/gpx.ts` + unit tests | DOMParser in Vitest env; projection correctness |
| 3. Import endpoint | replace-all `gpx-import` route + service | Non-atomic delete+insert on failure |
| 4. Calibration | loss + delta scaling in plan-table + UI | Touches the product wedge; must not regress |
| 5. Upload UI | file picker, confirm, manual loss, e2e | Child-form state refresh (remount key) |

**Prerequisites:** local Supabase running (`npx supabase start`, Docker); existing auth/test helpers.
**Estimated effort:** ~3–5 sessions across 5 phases.

## Open Risks & Assumptions

- Sample GPX confirmed: waypoints carry only `name` + lat/lon/ele → projection is mandatory (no order/distance to read).
- 3D distance + pure delta-sum produce inflated raw totals by design; the calibration delta absorbs this — acceptable only because the user corrects totals.
- Replace-all discards facility flags/notes on prior stations (mitigated by confirm).
- Non-atomic replace (no client transaction): a mid-import failure is recoverable by re-importing.

## Success Criteria (Summary)

- Uploading a GPX fills race details and creates the file's stations (named, ordered); no GPX → manual flow unchanged.
- Plan table shows gain and loss per segment; correcting a total rescales segments via the calibration delta.
- Bad/oversize/non-GPX files are rejected with a clear message and no data change.

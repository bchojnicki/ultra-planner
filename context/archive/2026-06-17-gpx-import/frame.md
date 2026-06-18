# Frame Brief: GPX upload for race plans (distance + elevation + aid stations)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Add GPX file upload to a race plan. On upload the app should: read total
distance from the track; compute total elevation gain and elevation loss
automatically from the track points; check for eight waypoints marking
stations and, if present, create eight aid stations from them; otherwise let
the user add stations manually by cumulative distance from start.

This is a pre-scoped v2 feature, parked in `context/foundation/prd.md:246`
(§Non-Goals) and `context/foundation/roadmap.md:177` as the "primary
MVP-complexity driver."

## Initial Framing (preserved)

- **User's stated cause or approach**: The GPX file is the source of truth.
  Read distance, compute gain/loss, read **eight** waypoints → eight stations;
  manual entry is the no-waypoints fallback.
- **User's proposed direction**: Build the upload + parse + auto-create
  pipeline; keep the existing manual `AidStationManager` flow as fallback.
- **Pre-dispatch narrowing** (clarified mid-frame, in the user's words):
  1. *Station count is not 8.* "8 was probably an example — there can be 0 aid
     stations or 20 or even more, it depends on the race." → import **N**
     stations from **N** waypoints; no exact-count rule.
  2. *Elevation accuracy is handled by calibration, not smoothing.* "Calculate
     it from GPX data, save in the background, display as race details; then
     the user can fix those values (gain, loss, distance); from the user-
     provided vs saved data find a delta in percents; later use that delta to
     adjust elevation gain and loss on each segment."
  3. *Waypoint data shape* — **confirmed via sample file**: each waypoint
     carries only a `name` and `(lat, lon, ele)`. No cumulative distance, no
     order field, no other metadata. → projection onto the track is the only
     way to get a station's cumulative distance; the `name` is the sole label.

## Dimension Map

The work could break (or hide complexity) at any of these dimensions:

1. **GPX parse & validation** — malformed files, missing `<trkpt>`/`<ele>`,
   namespaces, multiple tracks/segments, no waypoints at all.
2. **Distance computation** — summing haversine over track points; units must
   land in `km` to match `plans.total_distance_km`.
3. **Elevation gain/loss computation** — raw GPS elevation is noisy; naive
   delta-summing overstates gain/loss substantially.  ← original framing
   treats this as a simple read
4. **Calibration delta & persistence** — raw GPX value must persist so
   `(corrected − gpx)/gpx` can be computed after the user edits the plan's
   (now corrected) fields. Where does the raw value live?
5. **Waypoint → station mapping** — a waypoint is a `(lat,lon,ele)` pin with no
   intrinsic "distance from start"; cumulative distance/elevation per station
   must be derived by projecting each waypoint onto the track.  ← original
   framing treats this as a field read
6. **Aid-station model fit** — `aid_stations` stores only
   `cumulative_elevation_gain_m`; there is no per-station cumulative **loss**.
   "Adjust gain *and* loss per segment" is not representable today.
7. **Bulk creation path** — stations are created one-at-a-time via
   `POST /api/plans/:id/aid-stations`; importing N at once has no endpoint.
8. **Upload/UX flow** — background compute + save, display as editable race
   details, integrate with the existing autosave PATCH without clobbering.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| #5 Waypoints need track projection, not a field read | **Confirmed via sample GPX**: waypoints carry only `name` + lat/lon/ele — no distance, no order. `aid_stations` requires `cumulative_distance_km` (`supabase/migrations/20260603132423…sql:54`) which a raw waypoint does not provide → each must be projected onto the nearest track point and distance summed along the route. The `name` is the only station label (→ `aid_stations.notes`). | STRONG (verified) |
| #6 Per-station/-segment loss is not representable | `aid_stations` has `cumulative_elevation_gain_m` but **no** loss column (`…create_plans_and_aid_stations.sql`); `aidStationCreateSchema` mirrors this (`src/lib/schemas.ts:26`). Plans store both gain and loss; stations only gain. | STRONG |
| #4 Calibration delta needs raw GPX value persisted | `plans` fields (`total_elevation_gain_m/loss_m/distance_km`) are the *corrected* values the user edits; `planUpdateSchema` (`src/lib/schemas.ts:11`) PATCHes them directly. No field holds the original GPX-computed value → delta cannot be recomputed without it. | STRONG |
| #3 Elevation noise makes naive gain/loss wrong | Domain prior (GPS barometric/SRTM jitter); user pre-empted it with the calibration design rather than smoothing. Not a defect to fix, a decision already made. | RESOLVED (by design) |
| #7 No bulk-create endpoint for N stations | `src/lib/services/aid-stations.ts` exposes single-row `createAidStation`; UI POSTs one station per click (`AidStationManager.tsx:62`). | STRONG |
| Original: "exactly 8 waypoints → 8 stations" | User retracted: count is race-dependent (0..N). | REFRAMED |

## Narrowing Signals

- "8 was probably an example… 0 or 20 or even more" → the exact-eight branch is
  dropped; importer must handle 0 waypoints (→ manual fallback) and arbitrary N.
- The calibration sequence (GPX → background save → user-correct → delta% →
  per-segment scaling) reframes elevation from an *accuracy* problem into a
  *calibration + persistence* problem.

## Cross-System Convention

The repo derives per-segment values from cumulative station values downstream
(roadmap S-01/S-02: "per-segment values are derived downstream, not stored").
The calibration delta fits that convention — it's a scaling factor applied at
derivation time, not new stored segment rows. But it requires two model
additions the existing convention doesn't yet cover: a persisted **raw GPX**
measurement (for the delta denominator) and per-station cumulative **loss**
(so segments have a loss to scale).

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: build a GPX ingest pipeline that
> (a) computes track distance and noisy raw gain/loss, (b) projects an
> arbitrary number of waypoints onto the track to derive each station's
> cumulative distance/gain/loss, and (c) persists the *raw* GPX measurements
> alongside the user-correctable plan totals so a per-metric correction delta
> can later scale segment-level elevation — **not** a fixed "8 waypoints → 8
> stations" file reader.

The original framing held on the *upload + auto-fill + manual fallback* spine,
but broke on two points: the station count is arbitrary (not 8), and the two
hardest pieces are hidden — waypoint→track projection (waypoints carry no
distance) and the model gaps (raw-GPX persistence for the delta; per-station
cumulative loss). Addressing those is what makes the calibration feature
actually work end-to-end rather than only filling the plan's three top-level
numbers.

## Confidence

- **HIGH** — Codebase evidence for the model gaps and projection requirement is
  strong and verified with file:line, and the one previously-unverified input is
  now confirmed: the sample GPX's waypoints contain only `name` + lat/lon/ele.
  This locks the projection requirement (no waypoint distance/order to read) and
  means station ordering is derived from projected cumulative distance, with the
  waypoint `name` as the only label. No further verification needed before
  /10x-plan.

## What Changes for /10x-plan

The plan should be about a **calibration-aware GPX ingest pipeline**, not a
field reader: parse → distance + raw gain/loss → project N waypoints to
cumulative station metrics → persist raw GPX values + corrected plan totals →
derive per-metric delta → scale per-segment elevation. It must include schema
work (persist raw GPX gain/loss/distance; add per-station cumulative loss) and
a bulk aid-station create path, and it must drop the exact-eight assumption.

### Open computation decisions to research during planning

(Decided 2026-06-17: research folded into `/10x-plan` rather than a separate
`research.md` pass — there is no existing GPX code to discover; these are
external/algorithmic + runtime-constraint choices `/10x-plan` must resolve.)

1. **Distance** — 2D ground distance vs 3D slope distance (materially changes
   the total; ultra races usually quote 2D); haversine vs equirectangular.
2. **Raw elevation gain/loss method** — pure delta-sum vs minimum-threshold
   filter. This sets the *denominator* of the calibration delta, so the choice
   propagates into segment scaling.
3. **Waypoint→track projection** — nearest-track-point vs perpendicular-to-
   segment; behavior when a waypoint sits off the track.
4. **Parsing under Cloudflare Workers (`workerd`)** — the GPX parser must run
   without Node APIs (no `fs`, limited streams). Survey Workers-safe options
   (e.g. `@tmcw/togeojson`, `gpxparser`, hand-rolled `DOMParser`) before
   committing.

## References

- Source files:
  - `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql` (plans + aid_stations schema; no loss column on stations)
  - `src/lib/schemas.ts:11,26` (planUpdateSchema, aidStationCreateSchema)
  - `src/lib/services/aid-stations.ts` (single-row create only)
  - `src/components/plans/AidStationManager.tsx:62` (one-POST-per-station)
  - `src/components/plans/RaceSetupForm.tsx` (manual distance/elevation entry today)
  - `context/foundation/prd.md:246`, `context/foundation/roadmap.md:177` (parked v2 scope)
- Related research: none yet (`context/changes/gpx-import/research.md` absent)
- Investigation tasks: none dispatched (evidence gathered via direct reads)

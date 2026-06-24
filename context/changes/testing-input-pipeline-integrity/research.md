---
date: 2026-06-24T08:31:00+0200
researcher: Claude (10x-research)
git_commit: 65dc7a1
branch: main
repository: ultra-planner
topic: "Ground rollout Phase 2 of test-plan.md — Risk #2 (GPX extraction) + Risk #5 (segment recompute / stale gear-selection clearing)"
tags: [research, codebase, gpx, plan-table, gear-selections, segment-recompute, test-plan, risk-2, risk-5]
status: complete
last_updated: 2026-06-24
last_updated_by: Claude (10x-research)
---

# Research: Input-pipeline integrity (Risk #2 + Risk #5)

**Date**: 2026-06-24
**Researcher**: Claude (10x-research)
**Git Commit**: 65dc7a1
**Branch**: main
**Repository**: ultra-planner

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md`:

- **Risk #2** — GPX elevation extraction is wrong at the source, so totals and every
  downstream segment time/nutrition number inherit the error silently. Verify (not blindly
  accept) the response guidance: prove a GPX file whose total gain/loss is *independently*
  hand-computed yields exactly those totals; the oracle must be the fixture, never the
  parser's own output. Challenge "the existing gpx test passing ⇒ elevation is correct" and
  the "more track points ⇒ more accurate / smoothing" assumption.
- **Risk #5** — segment recompute after add/edit/delete of an aid station is wrong (merge on
  delete, re-sort on distance change, re-derive per-segment distance/elevation, clear stale
  per-segment gear selections). Challenge "re-sort is stable / entry order doesn't matter" and
  "per-segment selections survive a layout change."

Locate the entry points, verify oracle quality of existing tests, identify the cheapest useful
layer per gap, and flag speculative risk or misleading hot-spot evidence.

## Summary

Both halves of this phase look smaller than the §2 wording implies once the code is grounded —
the same pattern Phase 1 found. The genuine, fundable gaps are narrow and sit at the **unit
layer**; the existing integration suite already covers persistence round-trips.

1. **Risk #2 — the GPX math is pure, well-isolated, and already tested against an independent
   oracle.** `src/lib/gpx.ts` holds three pure functions (`distance3dKm`, `elevationGainLoss`,
   `projectWaypointsToStations`) plus one DOM-dependent `parseGpx`. `tests/unit/gpx.test.ts`
   re-derives its expected numbers from first principles (`DEG_LAT_M` rebuilt from the earth
   radius, hand-summed elevation deltas) — **no oracle-problem violation**. The one real gap:
   no test runs a **real multi-point `.gpx` fixture** with an externally-known total through the
   full parse→project chain, and the haversine shares the `6_371_000` radius constant with the
   source (so it is verified only in the small-angle limit, never against a true geodetic
   distance).

2. **Risk #2 — the server is a pure pass-through; `src/lib/gpx.ts` is the SOLE correctness
   gate.** The import route (`src/pages/api/plans/[id]/gpx-import.ts`) trusts the
   client-computed numbers: `gpxImportSchema.safeParse` checks only shape + non-negativity,
   then writes verbatim (`updatePlan` + replace-all `bulkInsertAidStations`). No server
   re-parse, no upper bounds, no cross-field check that `total_* ≈ gpx_*` or that station
   cumulatives are monotonic/within totals. That makes the pure functions load-bearing and
   worth a golden-fixture regression test. The raw `gpx_*` is the **calibration denominator**
   in `computePlanTable` (`metricCalibration`, plan-table.ts:33-36), so a wrong extraction
   silently skews every segment weight → time → nutrition number while still reconciling to the
   user-trusted total.

3. **Risk #5 — the segment RE-DERIVATION half is already covered by Phase 1.** "Merge adjacent
   on delete," "re-sort on distance change," and "re-derive per-segment distance/elevation" are
   all the pure `computePlanTable` (sort at lines 60, zero-length-leg skip at 101, beyond-finish
   drop at 58). Phase 1's `tests/unit/plan-table.test.ts` U1 (out-of-order sort), U2
   (duplicate → zero-length leg skipped = the merge), and U3 (beyond-total drop) **already lock
   this behavior**. Re-testing it in Phase 2 would duplicate coverage — the anti-pattern the
   test plan forbids.

4. **Risk #5 — the genuine net-new gap is the stale gear-selection reconciliation, and it is
   client-only, count-based, and has a real latent mis-attribution bug.** Reconciliation lives
   entirely in `PlanEditor.onStationsChange` (PlanEditor.tsx:120-136), which calls the pure
   `staleSegmentIndexes` (gear-allocation.ts:216-227). That rule is **positional and
   count-based**: it returns `[]` whenever `prevCount === nextCount` and otherwise only clears
   indices `>= nextSegmentCount`. So a re-sort/reorder that keeps the segment count, or an
   interior merge, leaves a saved selection silently attached to a *different* physical leg —
   `segment_index` is an ordinal with no FK to a station and no distance anchor. There is **no
   server/DB reconciliation**: the aid-station mutation routes never touch
   `gear_segment_selections`, nothing cascades from `aid_stations`, and the server helper
   `deleteSelectionsForSegments` is **dead code** (zero production call sites; only the
   integration test imports it). `staleSegmentIndexes` is pure → **cheapest useful layer is a
   unit test**, asserting the documented count-based contract against an independent oracle and
   exposing (not hiding) the interior-shift limitation.

**Cheapest useful layers:** unit (`tests/unit/gpx.test.ts` extended with a real fixture;
`tests/unit/gear-allocation.test.ts` for `staleSegmentIndexes`). The persistence path is
already covered by `tests/integration/gpx-import-flow.test.ts`; the full file→DB and UI-edit→
selection-clear orchestrations are e2e (the import flow's own comment defers file→numbers to a
Phase-5 Playwright test). Do **not** add integration tests that re-assert persistence
round-trips, and do **not** add e2e for what a unit test on the pure rule already catches.

## Detailed Findings

### Risk #2 — GPX extraction (`src/lib/gpx.ts` + import flow)

**The pure math (DOM-free, Node-testable):**
- `distance3dKm` ([gpx.ts:52-60](src/lib/gpx.ts#L52)) — 3D per-leg length: `sqrt(2d-haversine² + Δele²)`, summed, ÷1000.
- `elevationGainLoss` ([gpx.ts:63-72](src/lib/gpx.ts#L63)) — **raw delta-sum, no threshold/smoothing**: gain = Σ positive Δele, loss = Σ |negative Δele|. This is the documented root of Risk #2 and the single highest-signal oracle.
- `projectWaypointsToStations` ([gpx.ts:95-111](src/lib/gpx.ts#L95)) — snaps each `<wpt>` to the nearest track point (2D haversine), takes cumulative distance/gain/loss up to that index, sorts by cumulative distance, sets `notes = waypoint name`.
- `parseGpx` ([gpx.ts:134-147](src/lib/gpx.ts#L134)) — the **only** DOM-dependent function (`DOMParser`); needs `// @vitest-environment jsdom`. Throws on malformed XML; missing `<ele>` defaults to 0.

**Data flow (upload → DB), all numbers computed client-side:**
1. `GpxImport.handleFile` ([GpxImport.tsx:42-52](src/components/plans/GpxImport.tsx#L42)) — `parseGpx` → `elevationGainLoss` + `distance3dKm` + `projectWaypointsToStations`.
2. Corrected `total_*` are seeded directly from raw `gpx_*` with only rounding ([GpxImport.tsx:73-83](src/components/plans/GpxImport.tsx#L73)): `total_distance_km = round(gpx_distance_km*10)/10`, gain/loss rounded to whole metres. **On first import `total_* ≈ gpx_*`**; the runner corrects totals later via a separate autosave PATCH (the file header comment confirms), not in this flow.
3. POST → `src/pages/api/plans/[id]/gpx-import.ts:33-41` — `gpxImportSchema.safeParse`, then `updatePlan(supabase, planId, totals)` (writes all six numbers verbatim, `src/lib/services/plans.ts:54-58`) + `deleteAidStationsForPlan` + `bulkInsertAidStations` (verbatim rows, `src/lib/services/aid-stations.ts:46-58`). Only RLS ownership is enforced; **no numeric validation**.
4. `gpxImportSchema` ([schemas.ts:63-78](src/lib/schemas.ts#L63)) — `nonNegative = z.number().min(0)`, `z.strictObject`. No upper bounds, no cross-field rule. `gpx_*` are intentionally excluded from `planUpdateSchema` so later autosave can't overwrite the calibration denominator.
5. Downstream coupling — `metricCalibration(total, gpx)` returns `factor = total/gpx`, `finish = gpx` ([plan-table.ts:33-36](src/lib/plan-table.ts#L33)), applied per metric ([plan-table.ts:49-51](src/lib/plan-table.ts#L49)); each segment's raw diff is scaled by `factor`, `weight = distance + 0.01·gain` drives `moving`, which drives nutrition. A wrong `gpx_elevation_gain_m` skews every segment time and every fluid/carb/sodium cell.

### Risk #5 — segment recompute + gear-selection reconciliation

**Recompute is fully derived, every change (already Phase-1-covered):**
- `PlanEditor` holds live `params`/`stations`/`gearItems`/`selections`; the table is `useMemo(() => computePlanTable(params, stations), [params, stations])` ([PlanEditor.tsx:49](src/components/plans/PlanEditor.tsx#L49)). `computePlanTable` re-filters, **re-sorts** (plan-table.ts:60), re-pairs, and **skips zero-length legs** (plan-table.ts:101). Segments are never stored.
- Allocations map each row by positional index, filtering `selections` to `segment_index === idx` ([gear-allocation.ts:200-208](src/lib/gear-allocation.ts#L200)).
- `AidStationManager` persists each mutation then pushes a new sorted list up via `onStationsChange`: **add** ([AidStationManager.tsx:147](src/components/plans/AidStationManager.tsx#L147)), **delete** ([:167](src/components/plans/AidStationManager.tsx#L167)), **edit** applies optimistically in place with **no re-sort until `endEdit`** ([:245-247](src/components/plans/AidStationManager.tsx#L245), re-sort at [:271-273](src/components/plans/AidStationManager.tsx#L271)).

**Stale-selection reconciliation — CLIENT ONLY, count-based:**
- `PlanEditor.onStationsChange` ([PlanEditor.tsx:120-136](src/components/plans/PlanEditor.tsx#L120)) computes `prevCount`, recomputes `nextResult` for `nextCount` (the second `computePlanTable` at line 123), calls `staleSegmentIndexes(prevCount, nextCount, selections)`, removes stale selections locally, and fires `putSelection(idx, item, {limit_units:null, override_units:null})` per stale row — which `upsertGearSelection` ([gear-selections.ts:34-42](src/lib/services/gear-selections.ts#L34)) treats as a delete.
- `staleSegmentIndexes` ([gear-allocation.ts:216-227](src/lib/gear-allocation.ts#L216)) — **`if (prevSegmentCount === nextSegmentCount) return []`**, else clears only indices `>= nextSegmentCount`. The doc comment states the positional intent explicitly: "Growth never pushes an existing index out of range; an unchanged count needs no reconciliation."
- **No server/DB reconciliation.** Aid-station DELETE/PATCH ([api/aid-stations/[id].ts:14-56](src/pages/api/aid-stations/[id].ts#L14)) never touch selections. `gear_segment_selections` keys on `segment_index integer ... unique (gear_item_id, segment_index)` with cascades only from `plans`/`gear_items`, **not `aid_stations`** ([migration 20260616073641:23-30](supabase/migrations/20260616073641_create_gear_segment_selections.sql#L23)). The consistency trigger (`...073642`) only enforces `plan_id` match, nothing about segment validity. `deleteSelectionsForSegments` ([gear-selections.ts:63-75](src/lib/services/gear-selections.ts#L63)) has **no production call site** (verified: only `tests/integration/gear-flow.test.ts` imports it).

**The latent bug (genuine, not speculative):** because reconciliation fires only on a count change and only trims out-of-range indices, these cases silently mis-attribute a saved selection to the wrong leg:
1. **Reorder without count change** — editing a distance so AS2 sorts before AS1 keeps `nextCount === prevCount` → `staleSegmentIndexes` returns `[]`; the selection for index 1 now describes a different leg.
2. **Interior merge (delete a middle station)** — count goes N→N-1, so only the *top* index is cleared; selections on legs *below* the deleted station keep their index while the underlying leg shifted.
3. **Mutation while `PlanEditor` is not mounted** (raw API path) — nothing reconciles at all.

This is the core fragility Risk #5 should target. It is a real correctness gap (not "describing the implementation"), but whether to **fix** it (identity/distance-anchored selections) or **lock the current count-based contract** and flag the gap is a decision for `/10x-plan` — see Open Questions.

### Existing coverage and oracle quality

| Case | Covered? | Where | Oracle |
|---|---|---|---|
| `distance3dKm` flat / vertical / hypotenuse | ✅ | `tests/unit/gpx.test.ts:25-48` | **Independent** (`DEG_LAT_M` re-derived from earth radius) |
| `elevationGainLoss` climb / descent / zigzag | ✅ | `gpx.test.ts:51-66` | **Independent** (hand-summed deltas, comment) |
| `projectWaypointsToStations` snap / sort / empty | ✅ | `gpx.test.ts:78-106` | **Independent** + behavioral |
| `parseGpx` extract / default-ele / throw (jsdom) | ✅ | `gpx.test.ts:119-138` | **Independent** XML fixture |
| haversine vs a **real geodetic distance** | ⚠️ | `gpx.test.ts:17` shares `6_371_000` with source | small-angle only; no external truth |
| Real multi-point `.gpx` file → computed totals | ❌ | — (deferred to Phase-5 e2e per flow comment) | — |
| Persist `gpx_*` + corrected `total_*` to DB | ✅ | `tests/integration/gpx-import-flow.test.ts:143-153` | Independent literals, but **round-trip**, not GPX-derived |
| Replace-all station set (no dupes) + loss | ✅ | `gpx-import-flow.test.ts:155-171` | Behavioral / round-trip |
| Import zero-station no-op + RLS scoping | ✅ | `gpx-import-flow.test.ts:173-191` | Behavioral |
| Aid-station partial patch persists only given fields | ✅ | `tests/integration/aid-station-edit.test.ts:122-135` | Behavioral / round-trip |
| Aid-station edit/add/delete → **segment recompute** | ✅ (calc layer) | `tests/unit/plan-table.test.ts` U1/U2/U3 (Phase 1) | Independent (PRD) — **already covered** |
| Per-segment gear-selection persistence / upsert / null-clear | ✅ | `tests/integration/gear-flow.test.ts:331-366` | Behavioral / round-trip |
| `deleteSelectionsForSegments` removes **named** stale rows | ✅ | `gear-flow.test.ts:368-393` | Behavioral (**stale set supplied by the test**; helper is prod-dead) |
| `staleSegmentIndexes` derivation (which indices are stale) | ❌ | — | **Not covered** (pure, unit-able) |
| Stale selections cleared on a real layout change (orchestration) | ❌ | — | **Not covered** (client-only; e2e) |

**Integration wiring (cost to add):** real local Supabase at `http://127.0.0.1:54321` with the
CLI demo keys; `assertLocal()` guard; two auth users created/deleted per file in
`beforeAll`/`afterAll`; `fileParallelism: false`; needs Docker + `npx supabase start` + `db
reset`. No shared helper — each integration file inlines ~50 lines of setup. `vitest.config.ts`:
`environment: "node"` default, jsdom opted-in per file, `include` scopes to
`tests/{unit,integration}/**/*.test.ts`.

## Cheapest-layer test targets for `/10x-plan`

**Extend `tests/unit/gpx.test.ts` (pure math; oracle = hand-computed / published fixture; jsdom already set):**
- **G1** A small **real `.gpx` fixture** (`tests/fixtures/*.gpx`, 4–6 trkpts + 2 wpts) with hand-computed total distance/gain/loss → `parseGpx` then `distance3dKm` + `elevationGainLoss` + `projectWaypointsToStations` reconcile to the independent numbers, and a waypoint on a known point yields that point's cumulative values + its name in `notes`. Closes the "the three functions are only tested in isolation, never end-to-end on a real file" gap.
- **G2 (optional, defense-in-depth)** One leg with a **known real-world geodetic distance** (e.g. 1° of latitude ≈ 111.19 km) asserted within tolerance, to pin haversine beyond the small-angle limit that currently shares the source's radius constant.

**Extend/create `tests/unit/gear-allocation.test.ts` (pure rule; oracle = the documented positional contract):**
- **S1** `staleSegmentIndexes` returns `[]` when `prevCount === nextCount` (lock the count-based contract) — and a companion assertion that this is *why* a reorder-without-count-change does not prune (documents the known limitation rather than hiding it).
- **S2** When `nextCount < prevCount`, exactly the indices `>= nextCount` are returned, sorted and de-duplicated; growth (`nextCount > prevCount`) returns `[]`.
- **S3** `computeAllocations` filters selections by `segment_index === idx` so a selection whose index is out of range contributes to no row (the positional mapping that makes mis-attribution possible).

**Do NOT add:** segment re-derivation tests (Phase 1 U1/U2/U3 own them); integration persistence
round-trips (already covered); e2e for the file→DB or UI-edit→clear orchestration (defer, per
cost × signal and the import flow's own Phase-5 note).

## Code References

- `src/lib/gpx.ts:52-72` — `distance3dKm`, `elevationGainLoss` (raw delta-sum, no smoothing)
- `src/lib/gpx.ts:95-111` — `projectWaypointsToStations` (snap + cumulative + sort)
- `src/lib/gpx.ts:134-147` — `parseGpx` (DOM; jsdom-only)
- `src/components/plans/GpxImport.tsx:42-52,73-83` — client parse→compute→POST; raw seeds corrected totals
- `src/pages/api/plans/[id]/gpx-import.ts:33-41` — server pass-through (schema-only, replace-all)
- `src/lib/schemas.ts:63-78` — `gpxImportSchema` (shape + non-negative; no cross-field rule)
- `src/lib/plan-table.ts:33-36,49-51` — `metricCalibration` (raw `gpx_*` is the denominator)
- `src/components/plans/PlanEditor.tsx:49,120-136` — recompute memo + client-only reconciliation
- `src/lib/gear-allocation.ts:200-227` — positional allocation filter + `staleSegmentIndexes` (count-based)
- `src/lib/services/gear-selections.ts:34-42,63-75` — upsert/null-delete; dead `deleteSelectionsForSegments`
- `src/pages/api/aid-stations/[id].ts:14-56` — edit/delete routes (no selection cleanup)
- `supabase/migrations/20260616073641_create_gear_segment_selections.sql:23-30` — keying + cascades (none from `aid_stations`)
- `tests/unit/gpx.test.ts:17,25-138` — independent-oracle math tests (extend here)
- `tests/integration/gpx-import-flow.test.ts:143-191` — persistence round-trips (already cover persistence)
- `tests/integration/gear-flow.test.ts:368-393` — `deleteSelectionsForSegments` tested with a supplied stale list

## Architecture Insights

- **The client is the only validation layer for the input pipeline.** As in Phase 1 (the calc
  is the only guard for degenerate input), here the pure `gpx.ts` math is the only GPX
  correctness gate and the client `PlanEditor` is the only gear-selection reconciler. Both are
  deliberate MVP choices, and both make the pure functions production-critical → exactly the
  cheap, high-signal unit surface this phase should lock.
- **Positional segment identity is the structural fragility.** Selections key on a recomputed
  ordinal with no station/distance anchor, and reconciliation is count-based. The system is
  correct for the common "add/remove a station at the end" case and silently wrong for
  reorder/interior-merge. A test that asserts the *documented* contract is honest; a test that
  asserts "selections always follow the right leg" would fail against current code (it is a
  latent bug, not a regression to lock) — keep them separate.
- **Re-derivation vs reconciliation are different risks sharing one §2 row.** The calc
  re-derivation is solved and Phase-1-tested; the gear-selection reconciliation is the open
  surface. Phase 2 should name only the latter as net-new.

## Historical Context (from prior changes)

- `context/changes/testing-plan-generation-correctness/` (Phase 1) — locked `computePlanTable`
  sort/skip/drop behavior (U1/U2/U3) that already covers Risk #5's segment-re-derivation half;
  established the independent-oracle discipline and the "lock current behavior + defer the
  correctness question to a possible fix change" pattern reused here.
- `context/archive/2026-06-17-gpx-import/` — origin of `src/lib/gpx.ts`, the `gpx_*` columns,
  per-metric calibration, and the deliberate "no smoothing/threshold, no 2D distance, no
  `<rte>`" scope (gpx.ts:10-11). Explains why the raw delta-sum is by-design noise-sensitive.
- `context/archive/2026-06-1x-gear-*` (gear allocation + per-segment selections) — origin of
  `gear_segment_selections`, `staleSegmentIndexes`, and the dead `deleteSelectionsForSegments`.

## Backport corrections for `context/foundation/test-plan.md` (surface to `/10x-test-plan`)

Wording/response-guidance corrections only — no file anchors added (principle #3 holds). Defer
to `--refresh` or apply via the post-research backport check.

1. **Risk #5 wording is too broad.** "Failing to merge adjacent segments on delete, to re-sort
   on a distance change, to re-derive per-segment distance/elevation" are all the pure
   `computePlanTable`, **already locked by Phase 1 (U1/U2/U3)**. The real net-new Risk #5 gap is
   the **stale per-segment gear-selection reconciliation**, which is client-only and count-based
   with a latent interior-merge/reorder mis-attribution. Narrow the Risk #5 row (and the §3
   Phase 2 goal) to the selection-reconciliation surface; the segment-derivation clause is
   covered, not pending.
2. **Risk #5 cheapest layer is unit, not integration.** §2 Risk Response Guidance #5 says
   "integration (mutation → recompute → selection clear)." Research shows there is **no
   server/DB reconciliation to integration-test** — the clearing is a client-side pure rule
   (`staleSegmentIndexes`). Cheapest useful layer is **unit** (the pure rule); the full
   UI-edit→DB-clear path is **e2e**, not integration. Adjust the guidance.
3. **Risk #2 "smoothing" challenge is N/A.** The "more track points ⇒ more accurate / smoothing
   assumptions" challenge does not apply — `elevationGainLoss` is a documented **raw delta-sum
   with no smoothing/threshold** (a deliberate scope exclusion). The real property to assert is
   the exact delta-sum against a fixture; the noise-sensitivity is by-design, not a defect to
   test for. Keep the oracle-problem challenge (confirmed apt); replace the smoothing clause.
4. **Risk #2 is narrower than implied.** The pure math already has an independent oracle; the
   only gap is a real-`.gpx`-fixture end-to-end golden test and (optionally) a true-geodetic
   haversine check. Persistence is already covered by `gpx-import-flow.test.ts`.
5. **§3 Phase 2 test types "unit + integration"** → effectively **unit** for the net-new gaps;
   existing integration round-trips already cover persistence; e2e for file→DB and
   UI-edit→clear is deferred (consistent with the import flow's own Phase-5 note and Phase 1's
   no-e2e stance).

## Open Questions

- **Selection mis-attribution (for `/10x-plan` / possibly a separate fix change):** should the
  count-based `staleSegmentIndexes` be **fixed** to anchor selections on station identity or
  cumulative distance (so reorder/interior-merge prune correctly), or should Phase 2 **lock the
  current documented count-based contract** and file the deeper fix as its own change?
  Recommendation: lock current behavior with unit tests this phase (assert the positional
  contract, document the limitation), open a separate change if the team wants identity-anchored
  selections. Mirrors Phase 1's validation-tightening deferral.
- **Dead `deleteSelectionsForSegments` helper:** remove it, or wire it into the aid-station
  routes as a server-side safety net for the raw-API path? A decision for `/10x-plan`; Phase 2
  is test-only, so the default is to note it, not act.
- **Real-`.gpx` fixture provenance:** hand-author a tiny synthetic `.gpx` with computed totals
  (fully independent, deterministic) vs. embed a published real-course file (external truth but
  larger, licence to check). Recommendation: synthetic, hand-computed — deterministic and
  licence-free.

## Hot-spot evidence check

Not misleading. §2's likelihood evidence — `src/lib` (5 commits/30d) for Risk #2 and
`src/components/plans` (5 commits/30d) for Risk #5 — lands exactly on the grounded surfaces:
`src/lib/gpx.ts` / `src/lib/gear-allocation.ts` and
`src/components/plans/{PlanEditor,AidStationManager}.tsx`. Churn and risk surface coincide.

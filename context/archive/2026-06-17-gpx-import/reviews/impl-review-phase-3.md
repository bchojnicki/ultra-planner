<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: GPX Import — Import Endpoint + Service

- **Plan**: context/changes/gpx-import/plan.md
- **Scope**: Phase 3 of 5
- **Date**: 2026-06-18
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated Verification

- 3.1 Integration test — `npx vitest run tests/integration/gpx-import-flow.test.ts`: 8 passed ✅
- 3.2 Build — `astro sync && npm run build`: Complete ✅
- 3.3 Lint — `npm run lint`: No issues found ✅
- 3.4 (manual, HTTP-level) — deferred to Phase 5 e2e by user decision; pending, not rubber-stamped.

## Findings

### F1 — Non-transactional replace-all has a station-loss window

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; the plan already accepted it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/plans/[id]/gpx-import.ts:39-44
- **Detail**: The import sequences updatePlan → deleteAidStationsForPlan → bulkInsertAidStations with no transaction (Supabase has no client transaction). If the bulk insert fails after the delete succeeds, the plan keeps its new totals but ends up with zero stations — the old set is already gone. Matches the plan's documented idempotent-re-import tradeoff, so it is not drift; flagged for conscious sign-off.
- **Fix**: No Phase 3 code change. Carry a "surface a clear import-failed error" requirement into Phase 5 so a half-applied import is visible and the user re-imports.
- **Decision**: NOTED-FOR-PHASE-5 — queued in follow-ups/review-fixes.md.

## Notes

- Service helpers `deleteAidStationsForPlan` / `bulkInsertAidStations` match the contract and existing module style. The empty-array guard in `bulkInsertAidStations` is an addition beyond the contract but justified (waypoint-less GPX → zero stations; PostgREST rejects empty inserts) — Scope Discipline stays PASS.
- Endpoint matches contract exactly: prerender=false, 401/500/400 guards, gpxImportSchema validation, update→delete→insert sequence, 42501→403 / PGRST116→404, `{ plan, stations }` at 200.
- Integration test exercises the service layer (not the HTTP handler), consistent with the documented repo philosophy (`plans-flow.test.ts`); the endpoint's HTTP wiring is covered by the Phase 5 Playwright e2e.
- Independent waypoint validation (background run of COURSE_465097303.gpx, 5 waypoints) confirmed the waypoint-projection path: 5 correctly-named, distance-sorted stations with track-derived elevation — closes the waypoint half of manual check 2.4.

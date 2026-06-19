<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: GPX Import — Schema & Types Foundation

- **Plan**: context/changes/gpx-import/plan.md
- **Scope**: Phase 1 of 5
- **Date**: 2026-06-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated Verification

- Migration applied — `supabase migration up`: "Local database is up to date" ✅
- Build / type check — `astro sync && npm run build`: Complete ✅
- Lint — `npm run lint`: No issues found ✅

## Findings

### F1 — PlanTable loss fields deferred to Phase 4

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/types.ts:210-232
- **Detail**: Phase 1's "Changes Required #2" lists `PlanTableRow` gaining `segment_elevation_loss_m` and `PlanTableTotals` gaining `elevation_loss_m` (annotated "consumed in Phase 4"). Neither field was added. This is a defensible deviation, not a gap: both are required (non-optional) fields, and `computePlanTable` in src/lib/plan-table.ts constructs these object literals directly — adding the fields without populating them (the Phase 4 work) would fail `npm run build`, itself a Phase 1 success criterion. The plan double-lists the fields in Phase 1 and Phase 4; only Phase 4 can land them safely. The implementer correctly deferred.
- **Fix**: None needed now — verify both fields land in Phase 4 when plan-table.ts is updated to compute them. No Phase 1 action.
- **Decision**: ACCEPTED — deferral is correct; track for Phase 4.

## Notes

- Migration (`20260617120000_gpx_import_columns.sql`) matches the contract exactly: three nullable `gpx_*` columns on `plans`, `cumulative_elevation_loss_m numeric not null default 0` on `aid_stations`, no RLS changes. Additive / non-breaking.
- Types: `Plan` gains nullable `gpx_*`; `PlanInsert` makes them optional via `Partial<Pick<…>>`; `AidStation` + `AidStationInsert` get cumulative loss.
- Schemas: `gpxImportSchema` exactly as specified; `cumulative_elevation_loss_m` added to `aidStationCreateSchema`; **`planUpdateSchema` untouched** — autosave PATCH cannot overwrite the `gpx_*` delta denominator (key architectural guard). ✅
- Extra file `tests/unit/plan-table.test.ts` (added `gpx_*: null`, `cumulative_elevation_loss_m: 0` to factories) is a mechanically-required consequence of adding non-optional type fields, not scope creep — Scope Discipline stays PASS.

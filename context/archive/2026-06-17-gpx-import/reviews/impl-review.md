<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: GPX Import (full plan)

- **Plan**: context/changes/gpx-import/plan.md
- **Scope**: All 5 phases
- **Date**: 2026-06-18
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated Verification

- Unit + integration — `npx vitest run`: 88 passed (7 files) ✅
- E2E — `tests/gpx-import.spec.ts`: 3/3 browsers ✅
- Build — `astro sync && npm run build`: Complete ✅
- Lint — `npm run lint`: No issues found ✅
- Phase reviews on record: P1 APPROVED, P3 APPROVED (P3 F1 implemented in P5).

## Findings

### F1 — Read-only plan view shows arrival times in UTC, editor shows local

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/pages/plans/[id].astro:48 (+ PlanTable.tsx mount logic)
- **Detail**: The arrival-time fix (62efd2a) reformats UTC→local only after hydration (useSyncExternalStore "mounted"). The editor hydrates PlanTable (PlanEditor is client:load) → local time. The read-only saved view rendered `<PlanTable readOnly />` with no client directive → SSR-only, mounted stays false → arrival times in UTC. Same plan showed different clock times across views.
- **Fix A ⭐ (chosen)**: Add `client:load` to the read-only PlanTable so the mount→local reformat applies there too.
  - Strength: Reuses the fix already in PlanTable; both views agree.
  - Tradeoff: Ships React JS to a previously-static page (small hydration cost for a display-only table).
  - Confidence: HIGH — same mechanism proven in the editor.
  - Blind spot: Whether the read-only page intentionally avoided client JS (no evidence it did).
- **Fix B**: Leave read-only as UTC; track as follow-up (proper fix = store a race timezone).
- **Decision**: FIXED via Fix A — verified in-browser (read-only view: no console error, finish 01:31 AM local).

### F2 — Gated e2e can time out on a cold dev server

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/gpx-import.spec.ts
- **Detail**: The first navigation against a freshly-started `astro dev` server compiles routes/islands on demand, which can exceed the default 30s per-test timeout. Passes against a warm server (3/3 browsers). Gated behind TEST_EMAIL (skips in CI). Documented in follow-ups/review-fixes.md.
- **Fix**: Add `test.slow()` to triple the timeout (→ 90s) so a one-time cold compile fits.
- **Decision**: FIXED via Fix now — `test.slow()` added.

## Notes (no findings)

- Calibration model sound; `gpx_*` denominator correctly kept out of `planUpdateSchema`.
- Non-transactional replace-all (P3 F1) accepted and mitigated with a clear failure message in the UI.
- `O(waypoints × trackpoints)` projection is plan-acknowledged and trivial at realistic sizes.
- P4 Finish-anchor deviation (anchor on `gpx_*` so segments reconcile) documented in the commit and covered by tests.
- Scope guardrails respected: no raw-file storage, no `<rte>`, no smoothing, loss not time-weighted.

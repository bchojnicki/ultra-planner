<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Excel Export

- **Plan**: context/changes/excel-export/plan.md
- **Scope**: All 3 phases (complete)
- **Date**: 2026-06-19
- **Verdict**: APPROVED (with one minor warning, now fixed)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria re-run clean: unit 114/0, repo-wide lint exit 0 (the earlier
"2 pre-existing errors" were a transient type-service state during the xlsx
install — gone now), build clean, e2e 5 pass / 14 skipped. No unplanned files.

## Findings

### F1 — Export handler has no failure feedback

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/plans/PlanTable.tsx — handleExport()
- **Detail**: try/finally with no catch. If the dynamic import or buildPlanWorkbook threw, the button re-enabled silently and `void handleExport()` surfaced an unhandled rejection. GpxImport (the cited precedent) catches and shows a message.
- **Fix**: Added a `catch` that sets an `exportError` state rendering an inline "Export failed — please try again." message next to the button (console dropped to match the codebase's zero-console convention; `no-console` is warn-only and src has no console usage).
- **Decision**: FIXED

### F2 — Aid-station Notes split is an addition beyond "mirror the screen"

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/plan-export.ts — stationFacilitiesCell / header
- **Detail**: Implementation splits the aid-station data into "Aid station" (facilities + rest) and a separate "Notes" column, at the user's explicit mid-implementation request. Strict improvement, but plan.md didn't record it.
- **Fix**: Added an addendum note to the plan's Phase 1 §2 contract recording the two-column split and the `ArrayBuffer` return shape. Code unchanged.
- **Decision**: FIXED

### F3 — xlsx pinned to a CDN tarball, not the npm registry

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Supply chain)
- **Location**: package.json — "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
- **Detail**: Plan-sanctioned CDN tarball (avoids frozen npm xlsx@0.18.5 + its stale advisory); lockfile pins an integrity sha512 (reproducible/tamper-evident). Tradeoff: CI `npm ci` depends on cdn.sheetjs.com uptime, and npm audit / Dependabot won't track the URL dep. Write-only usage means the parse-path advisory doesn't apply.
- **Fix**: None — keep the CDN tarball; conscious, documented choice.
- **Decision**: SKIPPED (accepted)

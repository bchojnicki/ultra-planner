<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Generate Plan Table (S-02)

- **Plan**: context/changes/generate-plan-table/plan.md
- **Scope**: Phases 1–3 of 3
- **Date**: 2026-06-16
- **Verdict**: APPROVED (clean slice; 4 low-impact observations)
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria re-verified at review: `tsc` clean, `lint` exit 0, Vitest 27/27, Playwright e2e 2/2.

## Findings

### F1 — Editor width change (max-w-5xl) not in the plan

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Scope Discipline
- **Location**: src/pages/plans/[id].astro:22
- **Detail**: max-w-2xl → max-w-5xl added during manual verification at the user's request; benign and committed, but not in the plan's file contract.
- **Fix**: add a one-line plan addendum noting the width bump.
- **Decision**: FIXED (plan.md ## Addendum)

### F2 — start_time not validated in computePlanTable

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/lib/plan-table.ts:85
- **Detail**: An invalid start_time would make `new Date(...).toISOString()` throw (crashing the useMemo). Can't occur via the app, but the pure function wasn't defensive about it.
- **Fix**: if `Number.isNaN(startMs)`, return a missing_params-style error.
- **Decision**: FIXED

### F3 — FLAGS / enabledFacilities duplicated

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/components/plans/PlanTable.tsx & AidStationManager.tsx
- **Detail**: The six facility flags and an enabledFacilities helper existed in both components.
- **Fix**: hoist `AID_STATION_FLAGS` + `enabledFacilities` to `src/lib/aid-station-facilities.ts`; import in both.
- **Decision**: FIXED

### F4 — Table uses base-plan value for a currently-cleared required field

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/components/plans/RaceSetupForm.tsx (update → onParamsChange)
- **Detail**: onParamsChange emits `{...plan, ...buildPatch(next)}`; buildPatch omits invalid/empty fields, so clearing a field falls back to the initial value. On a fresh draft the error state still shows; on a loaded plan, clearing distance won't switch to the error state until reload. Matches autosave (won't persist invalid).
- **Fix**: optionally treat a cleared required field as 0 in the emitted plan; otherwise accept (current behavior is reasonable).
- **Decision**: SKIPPED

<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Input-pipeline integrity (GPX + segment recompute)

- **Plan**: context/changes/testing-input-pipeline-integrity/plan.md
- **Scope**: Full plan (Phase 1 + 2 of 2)
- **Date**: 2026-07-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Clean, disciplined test-only change. Both phases match the plan exactly:
- **Phase 1 (a750421)**: synthetic hand-computable GPX fixture (`tests/fixtures/sample-course.gpx`, equator course, 1°-of-longitude legs, integer elevation deltas) + G1/G2 end-to-end tests in `tests/unit/gpx.test.ts`. Gain/loss oracle (400/150) is fully constant-independent; G2 pins the earth-radius via a published literal (111.19 km at 1°). §6.4 cookbook filled.
- **Phase 2 (39a35ba)**: S1–S3 reconciliation tests in `tests/unit/gear-allocation.test.ts` that lock the count-based `staleSegmentIndexes` contract AND assert the reorder/interior-merge limitation as *current* behavior (never claiming correct-leg-following), plus positional-mapping tests for `computeAllocations`. Two deferred items recorded in `change.md`.
- **Epilogue (66aa07b)**: SHA write-back + `change.md` → implemented.

No `src/` change, no new dependencies, all "What We're NOT Doing" guardrails respected. Automated criteria pass under the project's real toolchain: `npm run lint` (eslint type-checked rules) clean, `npx vitest run tests/unit` 78/78 green, gpx 18/18, gear-allocation 21/21.

## Findings

### F1 — "Type-check" criterion passes via eslint/build, not raw tsc; repo has 4 pre-existing tsc errors in an unrelated test

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/unit/plan-export.test.ts:120,130,152,190 (NOT part of this change)
- **Detail**: Plan criterion 1.4 "Type-check passes" is satisfied by the project's real type-check path (`npm run lint` = eslint with type-checked rules, + `astro build`), which is green. A raw `npx tsc --noEmit` surfaces 4 errors — all in `plan-export.test.ts` (ArrayBuffer vs Uint8Array), all pre-existing at `a750421^` before this change, in a file this change never touched. This change's own files (`gpx.test.ts`, `gear-allocation.test.ts`) are tsc-clean.
- **Fix**: Out of scope here — track the pre-existing `plan-export.test.ts` tsc errors as a separate `/10x-new` change (tighten the xlsx buffer type or tsconfig test inclusion). No action on this plan.
- **Decision**: SKIPPED (out of scope — pre-existing, unrelated file; no action on this plan)

### F2 — GPX distance oracle shares the earth-radius constant with the source; radius independence rests solely on G2's single published-literal check

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (oracle rigor)
- **Location**: tests/unit/gpx.test.ts (G1b vs G2)
- **Detail**: G1's distance oracle re-derives `DEG_LAT_M` from `π/180·6_371_000` — the same radius the source uses — so G1b cannot catch a wrong radius constant. That independence is delegated entirely to G2's single assertion (`toBeCloseTo(111.19, 1)`, ±0.05 km at 1°). This is exactly the design the plan documents (G1 = wiring + leg-assembly + delta-sum oracle; G2 = radius anchor), and the gain/loss oracle (400/150) is fully constant-independent. Adequate as-is; noted only because the radius anchor is one coarse check.
- **Fix**: Optional — none needed. For a tighter radius anchor, add one more published-distance leg at a different latitude. Not required.
- **Decision**: SKIPPED (documented design; adequate, no action)

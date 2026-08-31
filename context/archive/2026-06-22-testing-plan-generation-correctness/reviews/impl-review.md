<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plan-generation correctness & boundaries

- **Plan**: context/changes/testing-plan-generation-correctness/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-06-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations (all triaged)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Independent re-run: `npx vitest run tests/unit` 70/70 green; `npm run lint` clean;
`package.json` / `package-lock.json` unchanged (no new deps). Scope respected — only the two
test files plus planning docs changed; no production source touched.

## Findings

### F1 — R1/R2 hardcode production copy strings

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/unit/plan-table-render.test.ts (R1/R2)
- **Detail**: R1/R2 built the error result with the verbatim message copy from
  `src/lib/plan-table.ts`. The assertion (component echoes `result.message`) is self-consistent
  and not an oracle violation, but the copy was duplicated.
- **Fix**: Replaced the copied strings with explicit test-only sentinel messages; the render
  branch reads only `ok`/`message`, so this removes the duplication while keeping the
  pass-through assertion valid.
- **Decision**: FIXED (Fix now)

### F2 — U3 verifies "identical table" via distances + labels, not all cells

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/unit/plan-table.test.ts (U3)
- **Detail**: Plan contract said the remaining table is "identical"; the test asserted only row
  count, labels, and `segment_distance_km`.
- **Fix**: Reused the same surviving-station object in both runs (so `endStation`'s random id
  compares equal) and added `expect(withBeyond.rows).toEqual(without.rows)` plus
  `expect(withBeyond.totals).toEqual(without.totals)` for full cell-by-cell identity.
- **Decision**: FIXED (Fix now)

### F3 — U4 proxies "weight ≥ distance" via moving_minutes > 0

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/unit/plan-table.test.ts (U4)
- **Detail**: `weight` is an internal `Segment` field not exposed on `PlanTableRow`; the test
  asserts the observable consequence (positive moving time on the clamped segment) instead.
- **Fix**: None — the proxy is the correct call given `weight` is not public.
- **Decision**: SKIPPED

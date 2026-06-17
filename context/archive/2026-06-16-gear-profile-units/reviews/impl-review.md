<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Gear Profile → Unit-Level Output (Hybrid)

- **Plan**: context/changes/gear-profile-units/plan.md
- **Scope**: All 6 phases
- **Date**: 2026-06-16
- **Verdict**: NEEDS ATTENTION (all findings minor / non-blocking)
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Debounced selection-PUT timers never cleaned up on unmount

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/plans/PlanEditor.tsx:46,78-86
- **Detail**: onSelectionChange stores setTimeout handles in timers.current but PlanEditor has no unmount cleanup. If the island unmounts within the 600ms window, the timer fires fetch() after teardown and a pending edit is dropped. Sibling useAutosave.ts:55-60 clears its timer on unmount.
- **Fix**: Add a useEffect unmount cleanup clearing all timers in timers.current, mirroring useAutosave.
- **Decision**: FIXED

### F2 — Selection PUT has no error handling (silent failure)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/plans/PlanEditor.tsx:50-56
- **Detail**: putSelection does `void fetch(...)` with no res.ok check and no catch. A failure leaves optimistic state diverged from the server with no retry or feedback, unlike every other write path.
- **Fix A ⭐ Recommended**: Route selection saves through a useAutosave-style status (saving/saved/error) shown near the gear panel.
  - Strength: Matches app-wide autosave UX; retry-on-next-change.
  - Tradeoff: More wiring — keyed-by-(segment,item) status.
  - Confidence: HIGH — useAutosave is the house pattern.
  - Blind spot: Needs a small status map, not one flag.
- **Fix B**: Minimal — check res.ok and on failure revert the optimistic row + transient error line.
  - Strength: Few lines; stops silent divergence.
  - Tradeoff: No retry; reverting mid-typing can surprise.
  - Confidence: MEDIUM — revert UX needs care.
  - Blind spot: Concurrent edits during a failed save.
- **Decision**: FIXED via Fix A

### F3 — Gear panel colSpan is a hardcoded magic number

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (maintainability)
- **Location**: src/components/plans/PlanTable.tsx:258
- **Detail**: Panel row uses colSpan={10}; correct today but decoupled from the header column count, so a future column add silently breaks the panel width.
- **Fix**: Derive the span (e.g. const colCount = gearActive ? 10 : 9) and use it.
- **Decision**: FIXED

### F4 — gear_segment_selections unique key omits plan_id

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data integrity)
- **Location**: supabase/migrations/20260616073641_create_gear_segment_selections.sql
- **Detail**: Denormalized plan_id isn't constrained to match the gear item's plan. RLS only checks plan_id ∈ caller's plans, so via raw API a caller could attach a selection whose plan_id and gear_item_id belong to two different owned plans, confusing deleteSelectionsForSegments. Same-user only.
- **Fix**: Add composite FK (plan_id, gear_item_id) → gear_items, or a trigger asserting consistency. Defensive; MVP-optional.
- **Decision**: FIXED (new migration 20260616073642)

### F5 — Quadratic work in the carb redistribution loop

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance, bounded)
- **Location**: src/lib/gear-allocation.ts:97-115
- **Detail**: exceeders.includes(it) inside active.filter is O(items²) per pass. Trivial at real scale and memoized, but needlessly quadratic.
- **Fix**: Build a Set of exceeder ids and filter against it.
- **Decision**: FIXED

### F6 — Selection upsert is last-write-wins under concurrent edits

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/services/gear-selections.ts:23-54
- **Detail**: Independent debounced PUTs have no cross-request ordering guarantee; rapid edits to the same (item,segment) rely solely on the 600ms debounce. Acceptable for single-user MVP.
- **Fix**: None needed for MVP — a one-line comment noting the last-write-wins assumption.
- **Decision**: FIXED (comment)

### F7 — Roadmap S-03 status still "proposed"

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md:35,114
- **Detail**: S-03 Status is still "proposed". By design — the roadmap convention flips Status → "done" via /10x-archive, not here.
- **Fix**: No action — /10x-archive flips it on archive.
- **Decision**: SKIPPED (resolves at /10x-archive)

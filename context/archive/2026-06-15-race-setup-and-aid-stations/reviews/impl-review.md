<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Race Setup + Aid Stations (S-01)

- **Plan**: context/changes/race-setup-and-aid-stations/plan.md
- **Scope**: Phases 1–3 of 3
- **Date**: 2026-06-15
- **Verdict**: NEEDS ATTENTION (all findings low-impact; nothing blocks archiving)
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria re-verified at review: `tsc` clean, `lint` exit 0, Vitest 18/18, `build` OK, Playwright e2e passing.

## Findings

### F1 — PATCH maps all update errors to 404

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/plans/[id].ts (catch block)
- **Detail**: The `try { updatePlan } catch { 404 }` turned every failure into 404, masking transient/server errors as a benign "not found".
- **Fix A ⭐**: Narrow the catch — PostgREST no-row (PGRST116) → 404, else rethrow → 500.
- **Decision**: FIXED via Fix A

### F2 — Failed station delete is silent

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/components/plans/AidStationManager.tsx (remove())
- **Detail**: A failed DELETE left the row with no feedback; the add path had an error message, delete didn't.
- **Fix**: Surface an error via the existing `error` state when the response is not ok.
- **Decision**: FIXED

### F3 — Islands don't reuse FormField/SubmitButton

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/components/plans/RaceSetupForm.tsx, AidStationManager.tsx
- **Detail**: Raw inputs + shared className instead of the auth FormField/SubmitButton (icon-oriented) components.
- **Fix**: Optionally refactor to FormField, or keep as the distinct "plans" input style.
- **Decision**: SKIPPED

### F4 — eslint.config.js change undocumented in the plan

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js
- **Detail**: Necessary + user-approved mid-flight, but not in the plan's file list.
- **Fix**: Add a one-line addendum to plan.md noting the .astro rule scoping.
- **Decision**: FIXED (plan.md ## Addendum)

### F5 — Duplicated json() helper

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/plans/[id].ts, src/pages/api/plans/[id]/aid-stations.ts
- **Detail**: Identical `json(body, status)` helper in two endpoints.
- **Fix**: Hoist to a shared helper when a third endpoint needs it (YAGNI now).
- **Decision**: SKIPPED

### F6 — Autosave drops the in-flight payload on error

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/components/hooks/useAutosave.ts
- **Detail**: `pending` is cleared before the await, so a failed save isn't auto-retried — only the next edit resends (full-state, so no data loss in practice). Indicator says "retry on next change".
- **Fix**: Optionally restore `pending` on error (risks a retry loop; current behavior is a reasonable MVP choice).
- **Decision**: SKIPPED

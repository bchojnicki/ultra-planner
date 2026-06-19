<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Collapsible (Roll-Up) Plan-Builder Sections

- **Plan**: context/changes/collapsible-plan-sections/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-06-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Collapse behavior has no executable verification in default CI

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: tests/collapsible-sections.spec.ts:15 ; plan.md Progress 2.4–2.9
- **Detail**: Manual rows 2.4–2.9 are marked [x], but the e2e spec encoding 2.4/2.5/2.7 is gated behind TEST_EMAIL + local Supabase and skipped in this run; rows 2.6/2.8/2.9 had no automated assertion. Gating matches every other flow spec in the repo, but collapse ships with no coverage in a plain `npx playwright test`.
- **Fix**: Add a GPX-import-preserves-collapse assertion (highest-risk untested path, 2.6) and run the gated spec once against local Supabase.
  - Strength: Closes the only collapse-specific path with zero coverage; matches the existing gpx-import.spec fixture pattern.
  - Tradeoff: Execution still requires local Supabase; the assertion is collected but skipped in plain CI.
  - Confidence: HIGH — mirrors the established gated-spec pattern.
  - Blind spot: Screen-reader (2.8) and visual spacing (2.9) remain inspection-only.
- **Decision**: FIXED — added second test in tests/collapsible-sections.spec.ts (collapse Aid → GPX import → assert still collapsed). Live run against local Supabase still outstanding (not available in review env).

### F2 — Save-status lifted to header instead of plan's favored in-body approach

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/plans/RaceSetupForm.tsx:132 ; src/components/plans/PlanEditor.tsx:165
- **Detail**: Plan favored rendering the save-status in-body; implementation lifted `status` up via `onStatusChange` into PlanEditor's `headerExtra`. Necessary deviation — in-body would be hidden by `hidden={collapsed}` and fail criterion 2.7. Verdict: DRIFT-but-correct.
- **Fix**: None needed.
- **Decision**: SKIPPED — accepted as documented correct deviation.

### F3 — useCollapsed uses useSyncExternalStore, not the planned mount-effect read

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/hooks/useCollapsed.ts:24
- **Detail**: Plan specified initializing to expanded and reading localStorage in a mount effect; that trips ESLint react-hooks/set-state-in-effect, so useSyncExternalStore was used (server snapshot=false, client snapshot from storage). Same SSR-safe, no-hydration-mismatch outcome, lint-clean, more idiomatic. Verdict: DRIFT-but-better.
- **Fix**: None needed.
- **Decision**: SKIPPED — accepted as documented better-than-planned deviation.

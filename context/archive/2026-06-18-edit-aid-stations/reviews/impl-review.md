<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Edit Aid Stations (full plan)

- **Plan**: context/changes/edit-aid-stations/plan.md
- **Scope**: All 2 phases
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

- Integration — `npx vitest run tests/integration/aid-station-edit.test.ts`: 4 passed ✅
- E2E — `tests/aid-station-edit.spec.ts`: 3/3 browsers (pre-fix run this session) ✅; post-fix headless re-run hit the documented auth-island cold-start flake (sign-in `getByLabel("Email")` timeout) — not a code regression (see F1 notes).
- Build — `astro sync && npm run build`: Complete ✅
- Lint — `npm run lint`: No issues found ✅

## Findings

### F1 — Optimistic edit could show an un-persisted value if distance went invalid mid-edit then the editor closed

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/plans/AidStationManager.tsx (onDraftChange / endEdit)
- **Detail**: A valid field edit applied an optimistic local update and scheduled a debounced PATCH. If the distance then became invalid within the 500 ms window, the pending PATCH was cancelled (correct — "block save while invalid"), but the earlier optimistic change stayed in local state; closing the editor discarded the draft without flushing, so the value showed locally/in the table yet was never persisted (reverted on reload). No corruption; narrow keystroke race.
- **Fix (chosen — Fix now)**: Snapshot the station at `beginEdit` and **advance the snapshot on each successful PATCH** (so it tracks the last-persisted state, not just pre-edit). On `endEdit` with an invalid distance, revert the row to that snapshot before re-sorting, so no un-saved optimistic value lingers.
- **Decision**: FIXED — verified in-browser: edited notes (saved → snapshot advanced), set distance to 0 (error), clicked Done; the row reverted to "60 km" **with the saved notes intact**, and a reload confirmed the DB state (60 km + notes, no 0).

## Notes (no findings)

- Both phases implemented exactly as planned: all-optional `aidStationUpdateSchema`; PATCH with `42501→403` / `PGRST116→404` / empty no-op; inline-expand editor (all fields, debounced autosave, distance validation freezing save while invalid, re-sort on collapse); `PlanEditor` wiring via the existing `onStationsChange`.
- Scope guardrails held: add-path left unvalidated by design, uniform GPX handling, no Save/Cancel button (Done collapses; autosave persists), identity fields not editable.
- Patterns match: per-route `json` helper, `useAutosave` status text, `useRef` debounce, `editTimer` cleanup on unmount, testid conventions.
- The gated e2e (`tests/aid-station-edit.spec.ts`) shares the headless auth-island cold-start flake tracked for gpx-import (gated/skipped in CI; passes against a warm server). Not specific to this change.

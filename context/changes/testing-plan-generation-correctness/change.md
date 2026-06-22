---
change_id: testing-plan-generation-correctness
title: "Test rollout Phase 1: plan-generation correctness & boundaries"
status: impl_reviewed
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md` — "Plan-generation correctness & boundaries".

**Risk covered:** Risk #1 — plan generation mishandles degenerate or malformed input (zero aid stations, a single station, or cumulative distances that decrease), producing a negative segment distance, a crash, or silently wrong numbers instead of the explanatory state the PRD requires.

**Test types planned:** unit + integration.

**Risk response intent:** prove that zero stations renders the explanatory state (no crash/empty table); a single station has defined behavior; a decreasing cumulative distance is rejected or surfaced, never silently fed to the calc as a negative segment. Expected values must come from an independent oracle (PRD Business Logic / hand-computed), **not** from the implementation under test (oracle problem).

This change needs codebase grounding before a plan can be written — `/10x-research` must locate the calc entry point, the per-segment distance/weight derivation, what input validation exists, and the zero-station UI state, and verify whether the existing `tests/unit/plan-table*.test.ts` assert against an independent oracle or their own output. Next step: `/10x-research`.

## Deferred items (recorded at Phase 2; not done in this change)

These were consciously scoped out of this test rollout (see `plan.md` "What We're NOT Doing"):

1. **Wire Vitest into CI.** `ci.yml` is lint+build and `playwright.yml` is e2e only — the new
   unit/render tests run locally only. The `test-plan.md` §5 gate "unit+integration required
   after Phase 1" stays `planned` until a future CI change wires it (CI YAML is owned by a
   different module/lesson, so it is out of scope here).
2. **Non-monotonic-elevation clamp UX.** U4 locks the calc's silent clamp-to-0 of a decreasing
   cumulative gain as intended behavior. Whether the UI should instead *surface a warning* is an
   open product/UX decision — a follow-up, not a test concern.
3. **Validation tightening (boundary rejection).** There is no server-side cross-field
   validation and no DB CHECK; `cumulative_distance > total` and `Infinity` persist and are only
   silently absorbed by the calc (asserted in U3/U6). A future `/10x-new` change may reject these
   at the API/DB boundary if the team wants hard rejection rather than the documented drop.

Also pending for the `/10x-test-plan` orchestrator (not this change): the §2 Risk #1 wording
reframe research recommended (research.md "Backport corrections").

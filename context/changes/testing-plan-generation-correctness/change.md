---
change_id: testing-plan-generation-correctness
title: "Test rollout Phase 1: plan-generation correctness & boundaries"
status: implementing
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

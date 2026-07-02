---
change_id: testing-input-pipeline-integrity
title: "Test rollout Phase 2: input-pipeline integrity (GPX + segment recompute)"
status: implementing
created: 2026-06-24
updated: 2026-06-24
archived_at: null
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md` — "Input-pipeline integrity (GPX + segment recompute)".

**Risks covered:** Risk #2 (GPX elevation extraction wrong at source, so totals and every downstream segment time/nutrition number inherit the error silently) and Risk #5 (segment recompute after add/edit/delete of an aid station is wrong — fails to merge adjacent segments on delete, re-sort on distance change, re-derive per-segment distance/elevation, or clear stale per-segment gear selections).

**Test types planned:** unit + integration.

**Risk response intent:**
- Risk #2: prove a GPX file whose total gain/loss is INDEPENDENTLY hand-computed yields exactly those totals (within rounding) and that waypoint cumulative elevations match the fixture — the oracle must be the fixture, never the parser's own output.
- Risk #5: prove deleting a station merges adjacent segments (combined distance/elevation), editing distance re-sorts and re-derives, adding inserts and re-derives, and per-segment gear selections that no longer map are cleared.

This change needs codebase grounding before a plan can be written — `/10x-research` must locate the GPX parse/extraction entry point, how gain/loss is accumulated (threshold? smoothing?) and where computed totals are persisted, how a waypoint maps to an aid-station cumulative elevation, and the segment-recompute path (merge-on-delete, re-sort-on-edit, selection-clearing when the layout changes), plus whether existing GPX/recompute tests assert against an independent oracle. Next step: `/10x-research`.

## Deferred items (recorded at Phase 2; not done in this change)

These were consciously scoped out of this test rollout (see `plan.md` "What We're NOT Doing")
and locked as *current* behavior by the Phase 2 reconciliation tests:

1. **Selection mis-attribution fix.** `staleSegmentIndexes` (`src/lib/gear-allocation.ts:216-227`)
   is positional and count-based: it returns `[]` whenever `prevCount === nextCount` and clears
   only indices `>= nextSegmentCount`. A reorder (count unchanged) or an interior merge silently
   leaves a saved per-segment gear selection attached to a now-different leg, because
   `segment_index` is an ordinal with no FK to a station and no distance anchor. The Phase 2
   tests assert this as current behavior (the interior-merge limitation case); a future
   `/10x-new` change may re-anchor selections on station identity / cumulative distance so
   reorder and interior-merge prune correctly.
2. **Dead `deleteSelectionsForSegments` helper.** Defined in
   `src/lib/services/gear-selections.ts:63-75` with **no production call site** (only the
   integration test imports it) — all reconciliation runs client-side in
   `PlanEditor.onStationsChange`. A future change may remove it, or wire it into the aid-station
   mutation routes as a server-side safety net for the raw-API path (mutations that bypass the
   mounted `PlanEditor` reconcile nothing today).

Also pending for the `/10x-test-plan` orchestrator (not this change): the 5 §2/§3 backport
corrections research recommended (research.md "Backport corrections" — Risk #5 reframe, Risk #5
cheapest-layer = unit not integration, Risk #2 smoothing-challenge N/A, Risk #2 narrower than
implied, §3 Phase 2 test-types effectively unit).

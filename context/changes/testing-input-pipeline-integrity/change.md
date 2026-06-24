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

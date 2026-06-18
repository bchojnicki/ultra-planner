---
change_id: edit-aid-stations
title: Edit an existing aid station (and enrich GPX-imported ones)
status: archived
created: 2026-06-18
updated: 2026-06-18
last_review: impl-review full-plan (APPROVED; F1 optimistic-revert fixed)
archived_at: 2026-06-18T19:37:32Z
---

## Notes

Implements PRD **US-10** / **FR-007** (added in PRD v5, 2026-06-18) — let a runner edit any field of an existing aid station (cumulative distance, cumulative elevation gain, cumulative elevation loss, time spent, facility checkboxes, crew notes), update in place, re-sort if distance changed, and recompute affected segments.

Motivated by `gpx-import` (now in PR #10): waypoint import creates aid stations with only distance/elevation/name — no facilities, time, or crew notes — so edit is the path to enrich them rather than delete-and-re-add. Reactivates the inline-edit companion deferred at FR-006.

Branch `edit-aid-stations` is stacked on `gpx-import` (it depends on the `cumulative_elevation_loss_m` column added there); rebase onto `main` once #10 merges.

Known starting points to settle in framing:
- No `PATCH /api/plans/[id]/aid-stations/[stationId]` endpoint yet; `updateAidStation` exists in `src/lib/services/aid-stations.ts` but is unwired.
- `AidStationManager.tsx` has the list + add + delete UI to extend; decide inline-expand vs modal.

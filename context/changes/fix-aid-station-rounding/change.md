---
change_id: fix-aid-station-rounding
title: Fix unrounded aid-station distance/elevation in the editor
created: 2026-06-19
updated: 2026-06-19
status: implemented
archived_at: null
---

## Notes

Spotted during manual testing of the `tooltips` change (archived `2026-06-18-tooltips`): when an aid station is displayed/edited in the first island (`AidStationManager`), distance and elevation show **without rounding** — a GPX-imported float renders in full.

Likely source: the inline-edit draft seeds inputs from `String(s.cumulative_distance_km)` etc. in `beginEdit` (`src/components/plans/AidStationManager.tsx`), so a long float surfaces directly in the edit fields. The collapsed list line already rounds (`Math.round(... * 10) / 10`); the edit inputs do not.

Out of scope for the tooltips change — opened as its own change. Decide during planning whether to round the seeded edit values (display concern) vs. preserve full precision for accuracy (the calc keeps full float precision by design — see the "accuracy guardrail" comments in `PlanTable.tsx`). This is a framing question worth settling before planning.

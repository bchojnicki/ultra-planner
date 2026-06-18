---
change_id: gpx-import
title: GPX upload — auto-fill race distance/elevation and pre-create aid stations from waypoints
status: implemented
created: 2026-06-17
updated: 2026-06-18
last_review: impl-review-phase-3 (APPROVED, 1 obs noted for p5)
archived_at: null
---

## Notes

Pick up the v2 feature parked in `prd.md` §Non-Goals and `roadmap.md` ("GPX import — GPX parsing is the primary MVP-complexity driver, deferred to v2+").

On GPX upload for a plan, the app: (1) computes total distance from the track; (2) computes total elevation gain and loss from the track points; (3) imports every waypoint in the file as an aid station (cumulative distance/elevation from start) — **not** a fixed count of 8; if the file has no waypoints, the existing manual `AidStationManager` entry remains the path. Computed totals save in the background and display as editable race details.

**Calibration design (decided 2026-06-17):** raw GPX gain/loss/distance are noisy, so instead of smoothing, the user can correct the three values. The system keeps the raw GPX value, derives a per-metric correction delta `(corrected − gpx) / gpx`, and later applies that delta to scale each segment's GPX-derived gain/loss so segment numbers reconcile to the user-trusted totals.

Framing captured in `frame.md`. Next: `/10x-plan gpx-import`.

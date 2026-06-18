---
change_id: tooltips
title: On-hover field-help tooltips across the plan forms
status: implemented
created: 2026-06-18
updated: 2026-06-18
archived_at: null
---

## Notes

Add small "?" help affordances next to form fields that, on hover/focus, show a short explanation of what the field means — so runners understand inputs like cumulative vs segment distance, hourly nutrition targets, calibration, etc. without external docs.

Third of three features planned 2026-06-18 (after `edit-aid-stations`; before `excel-export`). **No PRD change needed** — this is a UX enhancement, not a scope/non-goal item.

Cross-cutting across the plan forms (`RaceSetupForm`, `AidStationManager`, `GearProfileForm`, possibly `PlanTable` headers). Framing should settle: a reusable `HelpTooltip` component, where the help copy lives (inline vs a central map), hover-only vs hover+focus (a11y/touch), and which fields get hints. No tooltip primitive exists yet — check whether shadcn/ui `tooltip` is installed or needs `npx shadcn@latest add tooltip`.

Branch note: likely stack on `edit-aid-stations`/`gpx-import` or branch fresh from `main` once those merge.

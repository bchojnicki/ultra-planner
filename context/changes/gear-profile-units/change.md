---
change_id: gear-profile-units
title: Gear profile units
status: implemented
created: 2026-06-16
updated: 2026-06-16
archived_at: null
---

## Notes

### Scope reframe (planning session, 2026-06-16)

The user expanded S-03 well beyond the PRD's FR-004/US-06. Decisions locked so far:

- **Scope: Hybrid — auto-suggest + per-segment override.** Not the PRD's one-way auto-profile transform. The app auto-suggests fueling units per segment (FR-004 style) AND the runner can adjust quantities per segment. **Diverges from the locked PRD (FR-004/US-06) and roadmap S-03 — update prd.md + roadmap.md as part of this work.**
- **Carb/fluid sources:** gels (carbs), carb drink (carbs **and** fluid together), solid food (bars/bananas, carbs), plus a water carrier (bladder/soft flask). Runner can pick any number of these per segment ("what to take from each aid station").
- **Data model: a separate, owner-scoped table** (1:1-with-plan gear, RLS via the plan-subquery pattern). The hybrid model likely needs **two** tables: an item catalog + per-segment/aid-station selections — to be finalized in planning.

### Still open (to settle in the fresh planning pass)

- Catalog shape & where defined (per-plan catalog of item types vs ad-hoc per segment).
- Selection granularity: keyed per **aid-station** ("take here for the next leg") vs per derived segment index.
- Do items carry **sodium** too (3rd target), or carbs + fluid only for MVP?
- Table display: target vs planned-intake with over/under indicator; how auto-suggest seeds the selection.

### Prerequisites carried in

- Builds on S-02 `computePlanTable` (per-segment carb_g/fluid_ml targets) — the transform must NOT alter that calc, only present/compare against it.
- Reuse: F-01 migration+RLS pattern, S-01 service/endpoints/autosave-form, S-02 pure-transform + PlanEditor/PlanTable.


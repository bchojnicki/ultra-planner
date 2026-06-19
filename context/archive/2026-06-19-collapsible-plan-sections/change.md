---
change_id: collapsible-plan-sections
title: Collapsible (roll-up) plan-builder sections
created: 2026-06-19
updated: 2026-06-19
status: archived
archived_at: 2026-06-19T12:25:34Z
---

## Notes

Feature (reported 2026-06-19, "island roll up"): make the plan-builder sections collapsible — let the runner roll up / expand the Race parameters, Aid stations, and Gear sections to cut scrolling on long plans.

These sections are the React islands in the plan editor (`RaceSetupForm`, `AidStationManager`, `GearProfileForm`). Open decisions for `/10x-plan`: collapse affordance + default state (all expanded? remember per-section?), whether collapsed state persists across reloads, and a11y (disclosure pattern). Fourth of 4 post-MVP backlog changes.

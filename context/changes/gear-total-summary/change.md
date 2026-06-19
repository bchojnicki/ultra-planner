---
change_id: gear-total-summary
title: Show race-wide gear totals in the plan table total row
created: 2026-06-19
updated: 2026-06-19
status: implemented
archived_at: null
---

## Notes

Feature (reported 2026-06-19): the plan table's **total row** should show a gear summary — how many of each gear item is needed for the whole race (e.g. "12× SIS gel, 4× Tailwind, 6× salt cap"), so the runner knows total quantities to pack.

**Current state:** in `src/components/plans/PlanTable.tsx`, the `<tfoot>` total row leaves the Fuel column **empty** when gear is active (`{gearActive ? <td className="py-2 pr-4" /> : null}`, ~line 367). Per-segment fuel is already rendered via `fuelBreakdown(items, unitsOf(alloc))` (the `fuel-cell`). The total is the per-item **sum of units across all `allocations`**, rendered with the same `fuelBreakdown` helper.

Open decisions for `/10x-plan`: confirm the totals reflect post-limit/override allocations (allocations already carry final units), the display format in a narrow footer cell, and that it shows in the read-only (S-04) view too. Small, self-contained — sits naturally alongside the just-shipped `fix-gear-panel-position`. Fifth post-MVP backlog change.

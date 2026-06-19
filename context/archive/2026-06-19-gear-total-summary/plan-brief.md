# Race-wide Gear Total in the Plan Table Total Row — Plan Brief

> Full plan: `context/changes/gear-total-summary/plan.md`

## What & Why

The plan table's total row leaves the Fuel column empty when gear is active. This change fills it with a **race-wide gear summary** — the per-item sum of units across every segment (e.g. "12× SIS gel, 4× Tailwind") — so the runner knows the total quantity of each item to pack.

## Starting Point

`src/components/plans/PlanTable.tsx:365` renders an empty placeholder `<td>` in the `<tfoot>` total row. Per-segment Fuel cells already render their breakdown via the `fuelBreakdown` helper (line 47); allocations carry final post-limit/override units. Nothing sums them across segments yet.

## Desired End State

The Total row's Fuel cell shows the summed gear breakdown, formatted like the per-segment cells (wrapping text), blank when no units are suggested. The summation is a pure, unit-tested helper. The total appears identically in the editable and read-only (S-04) views with no extra work.

## Key Decisions Made

| Decision        | Choice                                   | Why (1 sentence)                                                       | Source |
| --------------- | ---------------------------------------- | --------------------------------------------------------------------- | ------ |
| Cell format     | Wrap, mirror per-segment cell            | Visual consistency with the column above; zero new styling.           | Plan   |
| Empty state     | Blank (no `—`)                           | Keeps today's footer behavior; avoids a placeholder reading as a value.| Plan   |
| Testing         | Extract pure helper + unit test + e2e    | Fast deterministic coverage of summation, plus end-to-end render check.| Plan   |
| Summation       | Straight sum, missing → 0                | The type guarantees one entry per item per allocation.                | Plan   |
| Helper location | New `src/lib/gear-totals.ts`             | Importable/testable without React; matches `src/lib/` convention.     | Plan   |

## Scope

**In scope:** a pure `sumAllocationUnits` helper + its unit test; rendering the total in the footer Fuel cell; extending the gear e2e.

**Out of scope:** any calc/type/schema/API change; per-segment cell changes; a label prefix or `—` placeholder; defensive item filtering.

## Architecture / Approach

`sumAllocationUnits(allocs)` reduces all `GearAllocationResult.units` into one `{gearItemId → count}` record (same shape `unitsOf` produces per segment), which the existing `fuelBreakdown(gearItems, …)` formats. Called once in the totals row. Read-only view inherits it because the footer cell gates on `gearActive`, not `readOnly`.

## Phases at a Glance

| Phase                     | What it delivers                                      | Key risk                                        |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| 1. Race-wide gear total   | Helper + unit test, footer cell render, e2e assertion | e2e total assertion must tolerate seg-2's suggested count |

**Prerequisites:** none — self-contained, builds on shipped gear-units slice.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Assumes `allocations` always carry one entry per item (confirmed by `src/types.ts:190-200`).
- The e2e assertion must be written to tolerate segment 2's auto-suggested gel count (assert "SIS gel" present + count ≥ overridden value, or the exact fixture-derived total).

## Success Criteria (Summary)

- Total row Fuel cell shows the correct race-wide gear sum, matching the per-segment cells.
- It updates when a per-segment override changes, and renders identically in the read-only view.
- New unit test and the extended e2e pass; lint and build are clean.

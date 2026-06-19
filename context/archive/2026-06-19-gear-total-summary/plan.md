# Race-wide Gear Total in the Plan Table Total Row — Implementation Plan

## Overview

The plan table's `<tfoot>` total row currently leaves the Fuel column **empty** when gear is active. This change fills that cell with a **race-wide gear summary** — the per-item sum of units across every segment (e.g. "12× SIS gel, 4× Tailwind, 6× salt cap") — so the runner sees the total quantity of each item to pack. The per-segment Fuel cells already render their breakdown via `fuelBreakdown`; this extends the same idea to the totals row.

## Current State Analysis

- **The gap**: `src/components/plans/PlanTable.tsx:365` renders `{gearActive ? <td className="py-2 pr-4" /> : null}` — an empty placeholder cell in the totals row that keeps column alignment but shows nothing.
- **The rendering helper exists**: `fuelBreakdown(items: GearItem[], units: Record<string, number>): string` (`PlanTable.tsx:47`) maps a `{gearItemId → count}` record to `"N× Name, …"`, listing each item once and skipping zero counts. Per-segment cells call it with `unitsOf(alloc)` (`fuel-cell`, `PlanTable.tsx:306-308`).
- **The data is already final**: `allocations` (`GearAllocationResult[]`, parallel to `result.rows` by `segment_index`) carry **post-limit/override** units. Each `GearAllocationResult.units` is `GearAllocationUnit[]` with "one entry per input item, in input order" (`src/types.ts:190-200`). Summing `units` per `gear_item_id` across all allocations yields the race total with no calc-layer change.
- **Read-only (S-04) is free**: the footer Fuel cell gates only on `gearActive` (`gearItems.length > 0 && allocs.length === rows.length`, `PlanTable.tsx:194`), not `readOnly`. The total appears in both the editable and read-only views automatically.
- **Test surface**: `tests/unit/plan-table.test.ts` covers only the pure calc (`computePlanTable`); there is no React component unit test. The gear feature's rendered output is exercised by the gated e2e `tests/gear-units.spec.ts` (requires `TEST_EMAIL` + local Supabase).
- **Helper locations**: pure gear logic lives in `src/lib/gear-allocation.ts`; `fuelBreakdown`/`unitsOf` are module-local (unexported) inside `PlanTable.tsx`.

## Desired End State

When a plan has gear defined, the plan table's **Total** row shows, in the Fuel column, the sum of each gear item's units across all segments, formatted identically to the per-segment Fuel cells (wrapping `"N× Name, …"` text). When no units are suggested for any item, the cell is blank (unchanged from today). The summation is a pure, unit-tested function. Verify by: running the new unit test (green), the extended e2e (green in a local env), and viewing a multi-segment plan with gear in both the editable and read-only (`/plans/[id]/view`) pages.

### Key Discoveries:

- Empty footer cell to replace: `src/components/plans/PlanTable.tsx:365`.
- Reusable formatter: `fuelBreakdown` at `src/components/plans/PlanTable.tsx:47`.
- Allocations carry final units, one entry per item: `src/types.ts:190-200`.
- Footer cell is `readOnly`-independent — read-only view needs no extra work.
- Pure-helper test convention: `tests/unit/plan-table.test.ts` + Vitest.

## What We're NOT Doing

- No change to the calc layer (`computePlanTable`, `gear-allocation.ts`) — allocations already carry the numbers.
- No new type, schema, migration, or API change.
- No `—` placeholder in the empty state (per decision: stay blank, unlike the per-segment cell).
- No "Total"/"Pack:" label prefix in the cell (the row's "Total" label already frames it).
- No defensive filtering of items missing from an allocation — straight sum, missing → 0 (the type guarantees one entry per item).
- No change to per-segment Fuel cells or any other column.

## Implementation Approach

Extract the cross-segment summation into a small pure helper so it's importable and unit-testable without rendering React, then call it once in the totals row and pass the result to the existing `fuelBreakdown`. Extend the e2e to assert the rendered total. This keeps the change presentational and reuses the established formatter and data shapes.

## Phase 1: Race-wide gear total

### Overview

Add a pure summing helper with a unit test, render its output in the `<tfoot>` Fuel cell, and extend the e2e assertion.

### Changes Required:

#### 1. Pure summation helper

**File**: `src/lib/gear-totals.ts` (new)

**Intent**: Provide a pure function that sums gear units across all segment allocations, so the totals row and its test share one importable source of truth.

**Contract**: Export `sumAllocationUnits(allocs: GearAllocationResult[]): Record<string, number>` — for every `GearAllocationUnit` across all `allocs`, accumulate `units` keyed by `gear_item_id` (missing items contribute nothing; result omits or zero-values absent items, consistent with how `fuelBreakdown` treats a missing/zero entry). Returns a record shaped exactly like the input `fuelBreakdown` expects (the same shape `unitsOf` produces for one segment). Import `GearAllocationResult` from `@/types`.

#### 2. Render the total in the footer Fuel cell

**File**: `src/components/plans/PlanTable.tsx`

**Intent**: Replace the empty footer placeholder cell with the race-wide gear breakdown, formatted like the per-segment Fuel cell but blank when there are no units.

**Contract**: At `PlanTable.tsx:365`, change `{gearActive ? <td className="py-2 pr-4" /> : null}` to render, when `gearActive`, a `<td>` containing `fuelBreakdown(gearItems, sumAllocationUnits(allocs))`. Use `whitespace-normal` (mirroring the per-segment `fuel-cell` at line 306) rather than `whitespace-nowrap`. Do **not** apply the `|| "—"` fallback used by the per-segment cell — an empty breakdown string renders as a blank cell. Add `data-testid="fuel-total-cell"` for the e2e. Import `sumAllocationUnits` from `@/lib/gear-totals`.

#### 3. Unit test for the helper

**File**: `tests/unit/gear-totals.test.ts` (new)

**Intent**: Lock the summation logic against regressions independent of the component.

**Contract**: Vitest `describe`/`it` (matching `tests/unit/plan-table.test.ts` style). Cover: (a) sums one item across multiple allocations; (b) sums multiple distinct items; (c) an item with zero units across all segments yields zero / is absent from the breakdown; (d) empty `allocs` → empty record. Assert against the record directly, and optionally feed the result through `fuelBreakdown` semantics by checking the totaled counts.

#### 4. Extend the e2e assertion

**File**: `tests/gear-units.spec.ts`

**Intent**: Confirm the rendered totals row shows the summed gear in the real end-to-end flow.

**Contract**: After the existing override step lands "3× SIS gel" on segment 1, add an assertion that `page.getByTestId("fuel-total-cell")` contains the race-wide total reflecting all segments' gels (i.e. the sum including the overridden segment-1 count). Keep the assertion robust to the second segment's suggested count (assert it `toContainText("SIS gel")` and that the leading number is ≥ 3, or assert the exact computed total if deterministic from the fixture).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run tests/unit/gear-totals.test.ts`
- Full unit suite passes: `npx vitest run`
- Type checking / lint passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- A multi-segment plan with gear shows the correct summed totals in the Total row's Fuel cell, matching the sum of the per-segment Fuel cells.
- The total reflects per-segment limit/override edits (change an override, the total updates).
- A plan with gear defined but zero suggested units shows a blank cell (no `—`).
- The total appears identically in the read-only view (`/plans/[id]/view`).
- No regression to per-segment Fuel cells or column alignment.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `sumAllocationUnits`: multi-segment single item, multiple items, all-zero item, empty allocations.

### Integration Tests:

- e2e (`gear-units.spec.ts`, gated): the totals Fuel cell shows the summed gear after a segment override.

### Manual Testing Steps:

1. Open a plan with ≥2 segments and ≥2 gear items; confirm the Total row Fuel cell equals the per-segment sums.
2. Override one segment's units; confirm the total updates accordingly.
3. Open `/plans/[id]/view` for the same plan; confirm the total renders identically.
4. Define gear but force all suggestions to zero; confirm the cell is blank.

## Performance Considerations

Negligible — one O(segments × items) pass over already-in-memory allocations on render.

## Migration Notes

None — no data or schema changes.

## References

- Change identity: `context/changes/gear-total-summary/change.md`
- Empty cell to replace: `src/components/plans/PlanTable.tsx:365`
- Formatter reused: `src/components/plans/PlanTable.tsx:47` (`fuelBreakdown`)
- Allocation shape: `src/types.ts:190-200`
- Pure-helper test pattern: `tests/unit/plan-table.test.ts`
- e2e flow: `tests/gear-units.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Race-wide gear total

#### Automated

- [x] 1.1 Unit tests pass: `npx vitest run tests/unit/gear-totals.test.ts` — 8d3664b
- [x] 1.2 Full unit suite passes: `npx vitest run` — 8d3664b
- [x] 1.3 Type checking / lint passes: `npm run lint` — 8d3664b
- [x] 1.4 Production build succeeds: `npm run build` — 8d3664b

#### Manual

- [x] 1.5 Total row Fuel cell shows correct summed totals matching per-segment cells — 8d3664b
- [x] 1.6 Total reflects per-segment limit/override edits — 8d3664b
- [x] 1.7 Zero-units plan shows a blank cell (no `—`) — 8d3664b
- [x] 1.8 Total appears identically in the read-only view — 8d3664b
- [x] 1.9 No regression to per-segment Fuel cells or column alignment — 8d3664b

# Fix gear edit panel rendering under the wrong segment Implementation Plan

## Overview

In the plan table, opening a segment's gear editor renders the limit/override panel at the **bottom of the table** (under the last segment) instead of under the segment being edited — and with several panels open they all stack there, detached from their rows. This fixes the render structure so each expanded gear panel appears directly beneath its own segment row. Multiple panels may still be open at once (unchanged behavior); only their position changes.

## Current State Analysis

- `src/components/plans/PlanTable.tsx` renders the table body in two separate passes over `rows`:
  - The **data rows** in the main `rows.map` (`:267-337`), each a single `<tr data-testid="plan-row">`.
  - The **expanded gear panels** in a **second, trailing `rows.map`** (`:338-354`) appended after all data rows inside the same `<tbody>`, each `<tr key="${r.label}-panel">` containing a `GearPanel`.
- Because the panel pass runs after the entire data-row pass, every expanded panel renders at the end of the `<tbody>`, after the last segment — the reported bug. Multiple open panels (the `expanded` state is a `Set<number>`, `:168`) all collect at the bottom.
- The per-row toggle button (`gear-toggle`, `:276-287`) and the `expanded`/`toggle` state (`:168`, `:198-205`) are correct — only the panel's render *location* is wrong.

### Key Discoveries:

- The fix is purely structural: emit each panel `<tr>` from inside the **main** `rows.map` (right after the data `<tr>`), and delete the trailing panel `rows.map`. No state, props, or data changes.
- A `rows.map` callback currently returns one `<tr>`; to return a data row plus an optional panel row it must return a keyed `React.Fragment` (or array) wrapping both — table semantics require the panel to be a sibling `<tr>`, so it can't be nested inside the data `<tr>`.
- `expanded` stays a `Set<number>` — multiple panels open at once is intended (confirmed with the user); the position fix alone resolves the confusion.
- The panel `<tr>` has no `data-testid` today (`:341`); adding one enables a DOM-adjacency regression assertion.
- The gear e2e flow lives in `tests/gear-units.spec.ts` (gated behind `TEST_EMAIL` + local Supabase/Mailpit); it already opens a panel via `gear-toggle` and reads `gear-panel`.

## Desired End State

Opening a segment's gear panel shows it immediately below that segment's row; opening several shows each under its own row, never collected at the bottom. Behavior (toggle, multiple-open, limit/override editing, persistence) is otherwise unchanged.

Verify: in a 2+ segment plan with gear, expand the first segment — the panel sits between segment 1 and segment 2, not after the last row; expand a second segment — its panel sits under that segment too.

## What We're NOT Doing

- Not changing the expand/collapse model — multiple panels stay openable at once (`Set`-based state retained).
- Not restyling the panel or the toggle button.
- Not touching `GearPanel`, the selection/override logic, allocations, or any API/data path.
- Not altering the totals footer or the non-gear (gram/ml/mg) rendering path.

## Implementation Approach

Move the panel render into the single `rows.map` so data row and (conditional) panel row are emitted together per segment, then remove the now-redundant trailing map. Add a `data-testid` to the panel row and a regression assertion that it renders adjacent to its segment.

## Phase 1: Render each gear panel under its own segment row

### Overview

Restructure the `<tbody>` render so each expanded panel is a sibling row immediately after its segment's data row, and remove the trailing panel block.

### Changes Required:

#### 1. Interleave the gear panel into the main row map

**File**: `src/components/plans/PlanTable.tsx`

**Intent**: Emit each segment's expanded gear panel directly after that segment's data row, instead of in a separate trailing pass, so the panel is anchored to the segment being edited.

**Contract**: In the main `rows.map` (`:267-337`), return a keyed `React.Fragment` containing the existing data `<tr>` plus — when `gearActive && onSelectionChange && expanded.has(idx)` — the panel `<tr>` (the same markup currently at `:341-351`, including `colSpan={colCount}` and the `GearPanel` with its existing props). Delete the trailing `{gearActive && onSelectionChange ? rows.map(...) : null}` block (`:338-354`). Move the fragment `key` to the wrapping fragment (e.g. `r.label`) and keep a distinct key on the panel `<tr>` (e.g. `${r.label}-panel`). Add `data-testid="gear-panel-row"` to the panel `<tr>` for the regression test. `expanded` stays a `Set<number>` — no state change.

#### 2. Regression test for panel adjacency

**File**: `tests/gear-units.spec.ts`

**Intent**: Assert the panel renders under its own segment, not at the bottom — locking in the fix.

**Contract**: In the existing gated e2e flow (2-segment plan with gear), after opening the first segment's panel via `gear-toggle`, assert the `gear-panel-row` is positioned with its segment (e.g. the opened panel appears before the second `plan-row`, or is the immediate sibling of the first row). Keep it within the current `TEST_EMAIL`-gated test; no new harness.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Playwright suite passes: `npx playwright test` (gear e2e runs only with `TEST_EMAIL` + local Supabase; otherwise skipped)

#### Manual Verification:

- In a 2+ segment plan with gear, expanding a middle segment shows the panel directly below that segment, not at the table bottom
- Opening multiple panels shows each under its own row (none collect at the end)
- Collapsing a panel removes only that row; toggle button state (▸/▾) still correct
- Limit/override editing + persistence still work from the repositioned panel
- The totals footer and non-gear plan rendering are unaffected

**Implementation Note**: After automated verification passes, pause for manual confirmation before the phase commit.

## Testing Strategy

### Manual Testing Steps:

1. Open a plan with gear and ≥2 segments; expand segment 1 → panel sits between rows 1 and 2.
2. Also expand the last segment → its panel sits under it; segment 1's panel stays under row 1.
3. Edit a limit/override in a repositioned panel → optimistic update + save still work.
4. Collapse each → the correct panel row disappears.

## Performance Considerations

None — same number of rendered rows, reorganized.

## Migration Notes

None — UI render-only change.

## References

- Bug location: `src/components/plans/PlanTable.tsx:338-354` (trailing panel map) vs `:267-337` (data rows)
- Gear e2e: `tests/gear-units.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Render each gear panel under its own segment row

#### Automated

- [x] 1.1 Type checking passes (`npx astro check`) — 6130022
- [x] 1.2 Linting passes (`npm run lint`) — 6130022
- [x] 1.3 Build succeeds (`npm run build`) — 6130022
- [x] 1.4 Playwright suite passes (`npx playwright test`) — 6130022

#### Manual

- [x] 1.5 Expanding a middle segment shows the panel directly below it, not at the table bottom — 6130022
- [x] 1.6 Multiple open panels each sit under their own row — 6130022
- [x] 1.7 Collapse removes only that panel; toggle state correct — 6130022
- [x] 1.8 Limit/override editing + persistence still work from the repositioned panel — 6130022
- [x] 1.9 Totals footer and non-gear rendering unaffected — 6130022

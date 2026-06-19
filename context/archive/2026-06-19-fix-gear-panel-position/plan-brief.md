# Fix gear edit panel rendering under the wrong segment — Plan Brief

> Full plan: `context/changes/fix-gear-panel-position/plan.md`

## What & Why

In the plan table, opening a segment's gear editor renders the limit/override panel at the bottom of the table (under the last segment) rather than under the segment being edited — and with several open they all stack there, detached from their rows. This anchors each panel beneath its own segment.

## Starting Point

`PlanTable.tsx` renders the `<tbody>` in two passes over `rows`: the data rows (`:267-337`), then a **separate trailing `rows.map`** for expanded gear panels (`:338-354`). The second pass runs after all data rows, so every open panel lands at the end of the table. State (`expanded` Set, `gear-toggle`) is correct — only the panel's render location is wrong.

## Desired End State

Expanding a segment shows its gear panel immediately below that segment's row; opening several shows each under its own row. Toggle, multiple-open, editing, and persistence are otherwise unchanged.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Root cause | Trailing `rows.map` panel block | Panels render after all data rows → pile at bottom | change.md (confirmed) |
| Fix | Interleave panel `<tr>` into the main row map (per-row fragment) | Anchors each panel to its segment; table needs sibling `<tr>` | Plan |
| Multiplicity | Keep multiple panels open (Set state retained) | Position fix alone resolves the confusion; allows side-by-side tuning | Plan |
| Test | Adjacency assertion in the gated gear e2e | Locks the fix without new harness | Plan |

## Scope

**In scope:** Move the panel render into the main `rows.map`; delete the trailing block; add `data-testid="gear-panel-row"`; a regression assertion in `tests/gear-units.spec.ts`.

**Out of scope:** Expand/collapse model, panel/toggle styling, `GearPanel` internals, selection/override logic, totals footer, non-gear rendering.

## Architecture / Approach

Single-file render reorder: each `rows.map` iteration returns a keyed `React.Fragment` of the data `<tr>` plus a conditional panel `<tr>` (when `gearActive && onSelectionChange && expanded.has(idx)`), and the separate trailing panel map is removed. No state, props, or data changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Render panel under its row | Panels anchored to their segment; regression test | Table-row keying / fragment structure (low) |

**Prerequisites:** None.
**Estimated effort:** ~1 short session, one phase.

## Open Risks & Assumptions

- Returning a fragment from `rows.map` requires correct keys (fragment key + distinct panel-row key) — minor.
- The gear e2e assertion runs only under `TEST_EMAIL` + local Supabase; CI without that env skips it (existing limitation).

## Success Criteria (Summary)

- Expanding any segment shows its panel directly below that segment, not at the table bottom.
- Multiple open panels each sit under their own row.
- Editing/persistence and totals/non-gear rendering are unaffected.

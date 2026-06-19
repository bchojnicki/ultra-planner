# Excel Export — Plan Brief

> Full plan: `context/changes/excel-export/plan.md`

## What & Why

Add an **"Export to Excel"** button to the saved-plan view that downloads a `.xlsx` of the runner's plan — race parameters, the generated segment-by-segment table, and the gear/fuel breakdown. The plan table currently lives only inside the web app; runners want a portable, printable spreadsheet to carry into race-day logistics (crew sheets, drop-bag planning). This un-parks a former PRD Non-Goal, the same way GPX import was.

## Starting Point

The saved-plan view (`/plans/[id]`) already computes the full plan table and gear allocations server-side and hands them to the `<PlanTable client:load>` React island. So every value the export needs is already in the browser — no recompute, no new endpoint. No spreadsheet library is installed yet, and the runtime is Cloudflare Workers.

## Desired End State

On a generated plan, an "Export to Excel" button sits beside "Edit plan". Clicking it downloads `<plan-name>.xlsx` — one worksheet with a race-parameters block, a spacer, then the segment table with totals and a Fuel column. Numbers are real (sortable/summable), rounded to match what's on screen. If the plan can't generate (missing params), the button isn't shown. The PRD and roadmap read this feature as shipped.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Data scope | Params + table + gear | A complete, self-contained record matching the on-screen plan | Plan |
| Generation site | Client-side (browser) | Zero Workers-runtime risk, no endpoint, mirrors the GPX-import precedent | Plan |
| Library | SheetJS (xlsx) community, write-only | Smallest footprint, well-known; the parse-path advisory never applies | Plan |
| Workbook layout | Single sheet, stacked blocks | Mirrors the screen, prints on one page, simplest to build | Plan |
| Numeric fidelity | Rounded to match display | Export matches the verified on-screen values; cells stay numeric | Plan |
| Not-generated state | Hide the button | No valid table exists, so never produce an empty sheet | Plan |
| Placement | View page only | The "finished plan" surface already holds the computed data | Plan |

## Scope

**In scope:** Client-side `.xlsx` generation; a pure builder module; an Export button on `/plans/[id]`; lazy-loaded SheetJS; Playwright coverage; un-parking the PRD/roadmap entries.

**Out of scope:** Server-side/endpoint generation; export from the editor; multi-sheet workbooks; custom styling; CSV/PDF; full-precision values; any schema/data change.

## Architecture / Approach

A pure `src/lib/plan-export.ts` maps the already-computed `{ plan, result, items, allocations }` into a SheetJS workbook and returns bytes — DOM-free and unit-testable. The `PlanTable` island renders the button, lazy-`import()`s SheetJS on click, wraps the bytes in a `Blob`, and triggers a download. Shared rounding/format helpers (`fmtDuration`, `fuelBreakdown`) are lifted out of `PlanTable.tsx` so the file and the screen can't drift.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Dependency + builder | SheetJS installed; pure `buildPlanWorkbook` → bytes | Rounding/format drift vs the table (mitigated by shared helpers) |
| 2. Export UI | Button + lazy-loaded download on `/plans/[id]` | SheetJS leaking into the initial bundle (mitigated by dynamic import) |
| 3. Tests + doc un-park | Playwright spec; PRD §Non-Goals + roadmap S-12 flipped to shipped | Download assertion flakiness in Playwright |

**Prerequisites:** S-02 (plan table) — already shipped. Local Supabase + a generated test plan for e2e.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- SheetJS install source: prefer the current community build (CDN tarball) over frozen npm `xlsx@0.18.5` to avoid stale-advisory audit noise; write-only usage means the parse-path CVE doesn't apply.
- Arrival times are ISO UTC in the data; the export emits a deterministic local `HH:MM` string (the one non-numeric column) — matches a mounted viewer.
- Assumes plans stay small (tens of rows), so in-browser build is instant.

## Success Criteria (Summary)

- From a generated plan, one click downloads a `.xlsx` whose params, segments, totals, and fuel match the screen and open cleanly in Excel/Numbers/Sheets.
- The button is absent when the plan can't generate.
- PRD §Non-Goals and roadmap S-12 are reconciled to shipped.

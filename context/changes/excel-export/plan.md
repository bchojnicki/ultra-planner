# Excel Export Implementation Plan

## Overview

Add an **"Export to Excel"** button to the saved-plan view (`/plans/[id]`) that downloads a single-sheet `.xlsx` workbook containing the plan's race parameters, the generated segment-by-segment table, and the gear/fuel breakdown. The file is built **entirely in the browser** with SheetJS from data already present in the page — no new API endpoint, no recompute. This un-parks a former PRD Non-Goal (the same path GPX import took), so the PRD §Non-Goals and roadmap S-12 status are flipped to shipped as part of the change.

## Current State Analysis

- The saved-plan view `src/pages/plans/[id].astro:22-27` loads the plan bundle (`loadPlanBundle`) and computes both `computePlanTable(plan, stations)` → `PlanTableResult` and `computeAllocations(result, gearItems, gearSelections)` → `GearAllocationResult[]` **server-side**, then passes `result`, `items`, and `allocations` into the `<PlanTable client:load>` island (`src/pages/plans/[id].astro:50`). Everything an export needs is already in that island's props.
- `PlanTableResult` (`src/types.ts:253-279`) is `{ ok: true, rows: PlanTableRow[], totals: PlanTableTotals } | { ok: false, error, message }`. Rows carry `label`, `segment_distance_km`, `segment_elevation_gain_m`, `segment_elevation_loss_m`, `moving_minutes`, `arrival` (ISO), `fluid_ml`, `carb_g`, `sodium_mg`, `endStation`. Totals mirror these plus `rest_minutes` and `finish_arrival`.
- Race parameters live on the `Plan` type (`src/types.ts:13-33`) and are rendered as a static block in `src/components/plans/PlanSummary.astro` — this is the canonical "what to show" list for the params block.
- Gear/fuel: `GearItem[]` (`src/types.ts:118-130`), per-segment units via `unitsOf(alloc)` and the race-wide total via `sumAllocationUnits(allocs)` (`src/lib/gear-totals.ts`); `fuelBreakdown(items, units)` (in `PlanTable.tsx:48-54`) renders the `"1× Tailwind, 2× SIS gel"` string.
- Display rounding is centralized in `src/lib/format.ts` (`fmtKm` → 0.1 km, `fmtM` → whole m); nutrients round to whole units; durations format as `h/m` via `fmtDuration` (local to `PlanTable.tsx`). The calc keeps full float precision — rounding is a display concern.
- **No spreadsheet library is installed** (`package.json` has none). Runtime is Cloudflare workerd, but client-side generation sidesteps any workerd compatibility question — only the browser bundle matters.
- **Precedent**: `src/components/plans/GpxImport.tsx` does all heavy file work client-side and only POSTs small numbers, explicitly to keep file processing off the Workers runtime. Excel export follows the same posture.
- Tests are Playwright (`tests/auth.spec.ts`); `npx playwright test`. There is no `npm test` script.

## Desired End State

On the saved-plan view, when a plan has generated successfully (`result.ok === true`), an **Export to Excel** button sits near the existing "Edit plan" action. Clicking it downloads `<plan-name>.xlsx` — a single worksheet with a race-parameters block, a blank spacer row, then the segment table with a totals row and a Fuel column. Cell values are real numbers rounded to match the on-screen display. When the plan cannot generate (missing params), the button is not shown. The PRD §Non-Goals entry and roadmap S-12 read as shipped.

Verify: open a generated plan, click Export, open the file in a spreadsheet app — params, every segment row, totals, and per-segment fuel match the screen; numbers are numeric (sortable/summable), not text.

### Key Discoveries:

- Export data is already computed and handed to the island — `src/pages/plans/[id].astro:50` passes `result`, `items`, `allocations`. The button belongs inside (or beside) that island, not behind a new endpoint.
- `result.ok === false` already swaps the table for an error panel (`PlanTable.tsx:179-188`); the export button must respect the same guard so it never builds an empty sheet.
- `fmtDuration` and `fuelBreakdown` currently live private to `PlanTable.tsx`; the export builder needs the same logic. Reuse by importing — extract or lift them so both the table and the export share one source of truth (avoid divergent rounding).
- SheetJS write path only needs `utils.aoa_to_sheet`, `utils.book_new`, `utils.book_append_sheet`, and `write`/`writeFile`. The read path (the source of the known prototype-pollution advisory) is never used.

## What We're NOT Doing

- No server-side / endpoint generation, no shareable export URL, no recompute path.
- No export from the live editor (`/plans/[id]/edit`) — view page only.
- No multi-sheet workbook (single stacked sheet only).
- No cell styling beyond what plain SheetJS community produces (no custom fonts/fills; a header row and number formats are acceptable if trivial, but polish is out of scope).
- No CSV / PDF / other formats.
- No new data: nothing is persisted, no schema or migration, no new RLS.
- No full-precision export — values are rounded to match the display.

## Implementation Approach

Client-side generation in the existing `PlanTable` island. A pure builder module (`src/lib/plan-export.ts`) maps the already-computed plan data into a SheetJS workbook and returns bytes; the React layer lazy-loads SheetJS on click, wraps the bytes in a `Blob`, and triggers a download. Keeping the builder pure (data-in → bytes-out, no DOM, no `import` of SheetJS at module top if we want it lazy) makes it unit-testable and keeps the heavy dependency out of the initial bundle via dynamic `import()`.

## Critical Implementation Details

- **SheetJS install source.** Prefer the current SheetJS community build over the frozen npm `xlsx@0.18.5` to avoid stale-advisory audit noise; the project may install from the SheetJS CDN tarball (`npm i https://cdn.sheetjs.com/xlsx-<ver>/xlsx-<ver>.tgz`) or pin `xlsx` from npm if the team prefers registry-only deps. Either way, **only the write API is used** — never `read`/`readFile` — so the prototype-pollution advisory in the parse path does not apply. Record the chosen source in `package.json`.
- **Lazy-load to protect the bundle.** Import SheetJS via dynamic `import()` inside the click handler, not at the top of `PlanTable.tsx`, so the library is not in the island's initial `client:load` payload.
- **Single shared rounding source.** The export must round identically to the table. Reuse `fmtKm`/`fmtM` from `src/lib/format.ts` and lift `fmtDuration`/`fuelBreakdown` out of `PlanTable.tsx` so the screen and the file cannot drift. Cells hold numbers (e.g. `Math.round(km*10)/10`), not the formatted strings — formatting strings would make Excel treat them as text.
- **Arrival times.** `arrival`/`finish_arrival` are ISO UTC. The table flips UTC→local after mount; for a downloaded file pick one deterministic rule (export local clock time `HH:MM` as a string label, matching what a mounted viewer sees) — note this is the one column that is a string, not a number.

## Phase 1: Dependency + Workbook Builder

### Overview

Add SheetJS and a pure builder that turns the computed plan data into `.xlsx` bytes.

### Changes Required:

#### 1. Add SheetJS dependency

**File**: `package.json`

**Intent**: Make a write-capable XLSX library available to the client bundle. Install the current SheetJS community build (CDN tarball preferred per Critical Implementation Details), used write-only.

**Contract**: A new `dependencies` entry for `xlsx` (SheetJS). `package-lock.json` updated. No other config.

#### 2. Plan-export builder module

**File**: `src/lib/plan-export.ts` (new)

**Intent**: Pure mapping from the already-computed plan data into a SheetJS workbook, returned as bytes (`Uint8Array`/`ArrayBuffer`). No DOM, no download side-effects — so it is unit-testable and the download wiring stays in the React layer. Builds one worksheet: a race-parameters key/value block (mirroring `PlanSummary.astro`'s field list), a blank spacer row, then a header row + one row per `PlanTableRow` + a totals row, with a Fuel column when gear is active.

**Contract**: Export e.g. `buildPlanWorkbook(input: { plan: Plan; result: PlanTableResult; items: GearItem[]; allocations: GearAllocationResult[] }): Uint8Array` and a filename helper `planExportFilename(plan: Plan): string` (→ `"<sanitized plan name>.xlsx"`). Uses `XLSX.utils.aoa_to_sheet`, `book_new`, `book_append_sheet`, `write({ type: "array", bookType: "xlsx" })`. Numeric cells carry display-rounded numbers (reuse `fmtKm`/`fmtM` rounding logic and the lifted `fmtDuration`/`fuelBreakdown` helpers); arrival columns carry `HH:MM` strings. Caller guarantees `result.ok === true` (builder may assert/return empty otherwise).

#### 3. Lift shared formatting helpers

**File**: `src/components/plans/PlanTable.tsx` → shared location (e.g. `src/lib/format.ts` or a small `src/lib/plan-format.ts`)

**Intent**: `fmtDuration` and `fuelBreakdown` are currently private to `PlanTable.tsx`; the builder needs the same logic. Move them to a shared module and import from both so the file and the screen cannot diverge.

**Contract**: `fmtDuration(min: number): string` and `fuelBreakdown(items: GearItem[], units: Record<string, number>): string` exported from a shared module; `PlanTable.tsx` imports them instead of defining them. Behavior unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (Astro type-check) or `npx astro check`
- Linting passes: `npm run lint`
- Unit test: `buildPlanWorkbook` returns non-empty bytes for a generated plan fixture and the sheet's cell values match expected rounded numbers (via SheetJS `utils.sheet_to_json` round-trip in the test)

#### Manual Verification:

- Generated `.xlsx` opens without a repair prompt in Excel / Numbers / Google Sheets
- Params block, all segment rows, totals row, and Fuel column values match the on-screen plan

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Export UI in the Plan View Island

### Overview

Wire an Export button into the plan view, lazy-load SheetJS on click, and trigger the download. Respect the not-generated guard.

### Changes Required:

#### 1. Export button + download handler

**File**: `src/components/plans/PlanTable.tsx` (or a thin sibling component rendered alongside it)

**Intent**: Render an "Export to Excel" button in the plan-table section header (near the existing `<h2>Plan table</h2>` / save-status row). On click: dynamically `import("xlsx")`-backed builder, call `buildPlanWorkbook`, wrap bytes in a `Blob` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), create an object URL, and click a temporary `<a download>` with `planExportFilename(plan)`. Revoke the URL after. Show the button only when `result.ok === true`.

**Contract**: Button is absent when `!result.ok`. Handler is async, guards against double-click while building. The component needs `plan` to derive the filename/params — if `PlanTable` does not already receive `plan`, thread it through as a new prop from `src/pages/plans/[id].astro`. No change to existing table rendering.

#### 2. Pass `plan` to the island if needed

**File**: `src/pages/plans/[id].astro`

**Intent**: Ensure the island has the `plan` object for the params block and filename.

**Contract**: `<PlanTable ... plan={plan} />` added to the existing usage at `src/pages/plans/[id].astro:50` if `plan` is not already a prop. Read-only view behavior otherwise unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` / `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds and the SheetJS chunk is code-split (dynamic import), not in the island's entry chunk

#### Manual Verification:

- Button appears on a generated plan, is absent when params are missing (error state)
- Clicking downloads `<plan-name>.xlsx`; the file matches the screen
- No console errors; no hydration warnings on the view page

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Tests + Doc Un-parking

### Overview

Add e2e coverage for the export and flip the PRD/roadmap un-parking status; stamp `change.md`.

### Changes Required:

#### 1. Playwright coverage

**File**: `tests/excel-export.spec.ts` (new, alongside `tests/auth.spec.ts`)

**Intent**: Verify the button appears on a generated plan and triggers a download (assert the `download` event and filename); verify the button is absent on a not-generated plan. Optionally assert the downloaded file is a non-empty `.xlsx`.

**Contract**: Uses Playwright's `page.waitForEvent("download")` and `download.suggestedFilename()`. Follows the auth/setup pattern already in `tests/auth.spec.ts`.

#### 2. Un-park in PRD

**File**: `context/foundation/prd.md`

**Intent**: Flip the §Non-Goals "XLS / Excel export" entry from "Planned, not yet shipped" to shipped (mirroring how GPX import was reconciled).

**Contract**: §Non-Goals Excel line updated; add a dated reconciliation note consistent with the existing v6 note style. No FR renumbering required (export is a UX/output capability, but add an FR/US line only if the doc's existing convention calls for one).

#### 3. Un-park in roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Mark roadmap S-12 (`excel-export`) status `todo` → `done`; update the backlog/handoff note.

**Contract**: S-12 status field and the summary table row (`roadmap.md:44`) updated to `done`.

#### 4. Stamp the change

**File**: `context/changes/excel-export/change.md`

**Intent**: Record completion of planning/implementation.

**Contract**: `status` and `updated` fields advanced per the change-md lifecycle.

### Success Criteria:

#### Automated Verification:

- Playwright passes: `npx playwright test tests/excel-export.spec.ts`
- Full suite still green: `npx playwright test`
- Lint/build pass: `npm run lint` && `npm run build`

#### Manual Verification:

- PRD §Non-Goals and roadmap S-12 read as shipped and are internally consistent
- Exported file verified once more end-to-end in a real spreadsheet app

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `buildPlanWorkbook` produces a sheet whose cell values (round-tripped via `XLSX.utils.sheet_to_json`) equal the expected display-rounded numbers for a fixture plan with and without gear.
- `planExportFilename` sanitizes plan names into a safe `.xlsx` filename.

### Integration Tests:

- Playwright: generated plan → Export → download event fires with the expected filename; not-generated plan → no button.

### Manual Testing Steps:

1. Open a fully generated plan with aid stations and gear; click Export; open the file — confirm params, every segment, totals, and Fuel match the screen and are numeric.
2. Open a plan missing required params (error state) — confirm no Export button.
3. Open a plan with no gear — confirm the Fuel column is omitted/blank consistently with the screen.
4. Confirm the file opens cleanly (no repair prompt) in Excel, Numbers, and Google Sheets.

## Performance Considerations

SheetJS is loaded via dynamic `import()` so it never enters the island's initial `client:load` bundle — it downloads only when the user clicks Export. Plans are small (tens of rows), so workbook construction is instant. No server load (client-side only).

## Migration Notes

None — no schema, no data migration, no persisted state.

## References

- View page (data source): `src/pages/plans/[id].astro:22-27,50`
- Table + private helpers to lift: `src/components/plans/PlanTable.tsx:25-54,179-188`
- Display rounding: `src/lib/format.ts`
- Gear totals: `src/lib/gear-totals.ts`
- Client-side-processing precedent: `src/components/plans/GpxImport.tsx`
- Types: `src/types.ts:13-33,118-130,239-279`
- Un-parking precedent (GPX): `context/archive/2026-06-17-gpx-import/`
- Roadmap S-12: `context/foundation/roadmap.md:44,205-210`
- PRD §Non-Goals: `context/foundation/prd.md:291-300`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dependency + Workbook Builder

#### Automated

- [x] 1.1 Type checking passes (`npm run build` / `npx astro check`)
- [x] 1.2 Linting passes (`npm run lint`)
- [x] 1.3 Unit test: `buildPlanWorkbook` returns non-empty bytes and cell values match expected rounded numbers

#### Manual

- [x] 1.4 Generated `.xlsx` opens without a repair prompt in Excel / Numbers / Google Sheets
- [x] 1.5 Params block, segment rows, totals, and Fuel column match the on-screen plan

### Phase 2: Export UI in the Plan View Island

#### Automated

- [ ] 2.1 Type checking passes (`npm run build` / `npx astro check`)
- [ ] 2.2 Linting passes (`npm run lint`)
- [ ] 2.3 Build succeeds and the SheetJS chunk is code-split (dynamic import), not in the island entry chunk

#### Manual

- [ ] 2.4 Button appears on a generated plan, absent when params are missing
- [ ] 2.5 Clicking downloads `<plan-name>.xlsx` matching the screen
- [ ] 2.6 No console errors or hydration warnings on the view page

### Phase 3: Tests + Doc Un-parking

#### Automated

- [ ] 3.1 Playwright passes (`npx playwright test tests/excel-export.spec.ts`)
- [ ] 3.2 Full suite still green (`npx playwright test`)
- [ ] 3.3 Lint/build pass (`npm run lint` && `npm run build`)

#### Manual

- [ ] 3.4 PRD §Non-Goals and roadmap S-12 read as shipped and are internally consistent
- [ ] 3.5 Exported file verified end-to-end in a real spreadsheet app

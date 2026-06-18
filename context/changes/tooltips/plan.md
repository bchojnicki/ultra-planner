# On-hover field-help tooltips Implementation Plan

## Overview

Add an accessible, reusable help affordance to the plan-builder forms so a runner unfamiliar with the model can understand domain inputs (cumulative vs total distance, hourly nutrition targets, carb ratio, calibration) without external docs. A small "?" icon-button sits after the label of each non-obvious field and, on hover / keyboard-focus / touch, shows a short explanation. Help copy lives in one central map; the tooltip is built on the shadcn Radix `tooltip` primitive.

## Current State Analysis

- **No tooltip primitive exists.** `src/components/ui/` contains only `button.tsx`. The sole Radix dependency in `package.json` is `@radix-ui/react-slot` — the Radix family is already in the tree, but no tooltip is installed. shadcn/ui is configured ("new-york", per CLAUDE.md), so `npx shadcn@latest add tooltip` is the convention-fit way to add it.
- **Every form field shares one label pattern**: `<label htmlFor=… className="mb-1 block text-sm text-blue-100/80">Label</label>` above an input. A help affordance hangs off the label cleanly.
- **Label metadata is already centralized** in two places — `src/lib/gear-kinds.ts` (`GEAR_FIELD_LABELS`, `GEAR_KIND_LABELS`) and `src/lib/aid-station-facilities.ts` (`AID_STATION_FLAGS`). A `src/lib/field-help.ts` copy map mirrors this established pattern exactly.
- **Target surfaces**:
  - `src/components/plans/RaceSetupForm.tsx` — `NUMERIC_FIELDS` array (`RaceSetupForm.tsx:35`), plus the bespoke Start time (`:183`) and Expected finish (`:198`) blocks, and the Plan name field (`:150`, skipped).
  - `src/components/plans/AidStationManager.tsx` — the add form labels (`:269`–`:347`) and the inline edit panel `EDIT_NUM_FIELDS` (`:31`, rendered at `:433`). Add form and edit panel share label text but are separate JSX.
  - `src/components/plans/GearProfileForm.tsx` — the kind `<select>` (`:255`), the per-row `GEAR_FIELD_LABELS` inputs (rendered at `:164` for rows and `:289` for the add draft), and Name (skipped).
  - `src/components/plans/PlanTable.tsx` — the `<thead>` column headers (`:228`–`:238`): Segment, Dist, Gain, Loss, Time, Arrival, Fluid, Carbs, Sodium, Fuel, Aid station.
- **These are React islands** (no "use client" directive — Astro convention per CLAUDE.md). The tooltip must work under client hydration.

## Desired End State

Each non-obvious field across the plan-builder forms carries a "?" icon-button immediately after its label. Hovering, keyboard-focusing (Tab to the button), or tapping (touch) the button reveals a short, plain-language explanation; Escape and blur dismiss it. The tooltip content is associated with the trigger via `aria-describedby` so screen readers announce it. All help copy is authored in `src/lib/field-help.ts`. No data, API, or persistence behavior changes.

Verify by: running the app, tabbing through `RaceSetupForm` and confirming each "?" is reachable and shows copy; hovering a column header in the plan table; and confirming lint/build/typecheck pass.

### Key Discoveries:

- shadcn Radix tooltip handles focus/touch/escape/positioning correctly — the a11y requirement (frame-settled: hover + focus + touch) is what selects it over a custom or native-`title` approach (`frame.md:39`).
- Radix `Tooltip` requires a `TooltipProvider` ancestor. Each island is independently hydrated, so the provider must be placed inside each form (or wrapped by the shared HelpTooltip) — there is no single app-root React tree to host one provider.
- `gear-kinds.ts:11` is the precedent for a typed label/metadata map keyed by a domain enum — `field-help.ts` should follow the same shape (typed keys, `Record<…, string>`).
- The AidStationManager edit panel (`:433`) reuses the same field labels as the add form via the `EDIT_NUM_FIELDS` array — wiring help into that array covers both the add and edit surfaces from one place where it's array-driven, but the add form labels are hand-written JSX and must be wired individually.

## What We're NOT Doing

- Not adding help to self-evident fields: Plan name, gear item Name, Crew notes, facility checkboxes, and the obvious plan-table columns (Segment, Dist, Gain, Loss, Aid station).
- Not changing any data model, API endpoint, validation, or autosave behavior.
- Not building a custom tooltip/popover or using native `title` (frame-rejected on a11y grounds).
- Not adding a global help/docs page, onboarding tour, or per-field links to external documentation.
- Not introducing i18n/translation for the copy — English strings inline in the map, matching the rest of the UI.
- Not restyling the existing forms beyond inserting the affordance.

## Implementation Approach

Three phases, each independently verifiable. Phase 1 lands the primitive, the reusable `HelpTooltip` wrapper, and the central copy map with nothing wired — so the building block is testable in isolation. Phase 2 wires help into the three input forms (the bulk of the value). Phase 3 adds header tooltips to the read-only plan table. The `HelpTooltip` component owns the `TooltipProvider`, the icon-button trigger, accessibility wiring, and styling, so each call site is a one-liner: `<HelpTooltip text={FIELD_HELP.someKey} label="…" />` placed inside the label row.

## Critical Implementation Details

- **Provider placement** — Radix `Tooltip.*` throws or no-ops without a `TooltipProvider` ancestor. Because each form is a separately-hydrated island, wrap the provider inside `HelpTooltip` itself (one provider per affordance is acceptable for this scale and keeps call sites trivial), or render one provider near the top of each form. Decide in Phase 1 and keep it consistent; the per-component-provider approach is simplest and avoids leaking a provider requirement to every call site.
- **Label association** — the trigger is a separate focusable `<button type="button">`, not part of the `<label htmlFor>`. Keep the existing `label`→`input` association intact; give the trigger its own `aria-label` (e.g. "Help: Carb ratio") and let Radix wire `aria-describedby` from trigger to tooltip content. Do not nest the button inside the `<label>` (clicking it would focus the input).
- **Touch behavior** — Radix tooltips open on `focus`; on touch devices the icon-button receives focus on tap, which surfaces the tooltip. No separate touch handler is needed, but verify on a touch viewport during manual testing.

## Phase 1: Primitive & foundation

### Overview

Install the shadcn tooltip primitive, build the reusable `HelpTooltip` affordance, and author the central help-copy map. Nothing is wired into a form yet — this phase is verifiable on its own via a typecheck/build and a temporary render.

### Changes Required:

#### 1. shadcn tooltip primitive

**File**: `src/components/ui/tooltip.tsx` (generated)

**Intent**: Add the Radix-backed tooltip primitive that the affordance builds on, using the project's shadcn setup so it matches the "new-york" style and existing `button.tsx` conventions.

**Contract**: Run `npx shadcn@latest add tooltip`. This creates `src/components/ui/tooltip.tsx` exporting `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` and adds `@radix-ui/react-tooltip` to `package.json`. Do not hand-write this file; let the CLI generate it, then verify it imports `cn` from `@/lib/utils` like the other ui components.

#### 2. Reusable HelpTooltip affordance

**File**: `src/components/ui/HelpTooltip.tsx` (new)

**Intent**: A single component that renders the "?" icon-button trigger after a label and shows the given help text on hover/focus/touch, with correct accessibility wiring — so every call site is a one-liner.

**Contract**: Props `{ text: string; label: string }` (`label` names the field for the trigger's `aria-label`, e.g. `aria-label={`Help: ${label}`}`). Renders a `TooltipProvider` > `Tooltip` > `TooltipTrigger asChild` wrapping a small `<button type="button">` with a "?" glyph/icon, and `TooltipContent` containing `text`. The button is styled to sit inline after label text (small, muted, `rounded-full`, focus ring consistent with the forms' `focus:ring-purple-400`). Uses `cn()` for class composition. The button must not submit forms (`type="button"`) and must be keyboard-focusable.

#### 3. Central field-help copy map

**File**: `src/lib/field-help.ts` (new)

**Intent**: One authored source of truth for all help strings, mirroring the `gear-kinds.ts` label-map pattern, so copy can be edited and reviewed in one place.

**Contract**: Export a typed map (e.g. `export const FIELD_HELP = { … } as const` with an exported key type). Keys are stable identifiers grouped by surface — race setup (total_distance, elevation_gain, elevation_loss, hourly_fluid, hourly_carbs, hourly_sodium, start_time, expected_finish), aid station (cumulative_distance, cumulative_gain, cumulative_loss, time_at_station), gear (kind, carb_g, sodium_mg, fluid_ml, capacity_ml, carb_ratio), and plan-table headers (col_time, col_arrival, col_fuel, col_fluid, col_carbs, col_sodium). Each value is a one-to-two-sentence plain-language explanation. Author copy now (this phase) so Phases 2–3 only wire references.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` (or `npm run build`)
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- `src/components/ui/tooltip.tsx`, `src/components/ui/HelpTooltip.tsx`, and `src/lib/field-help.ts` exist; `@radix-ui/react-tooltip` is in `package.json`

#### Manual Verification:

- Temporarily render `<HelpTooltip text="test" label="Test" />` on a page; the "?" button appears, opens on hover, on Tab+focus, and on tap; Escape/blur dismisses it
- Tooltip content is announced by a screen reader (VoiceOver) via `aria-describedby`
- Remove the temporary render before completing the phase

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Input forms

### Overview

Wire `HelpTooltip` into the three input forms, referencing `FIELD_HELP` copy. Help appears after the label of each non-obvious field in `RaceSetupForm`, `AidStationManager` (add form + edit panel), and `GearProfileForm` (rows + add draft + kind selector).

### Changes Required:

#### 1. RaceSetupForm field help

**File**: `src/components/plans/RaceSetupForm.tsx`

**Intent**: Add a help affordance after the labels of the numeric fields, Start time, and Expected finish; leave Plan name bare.

**Contract**: Extend `NUMERIC_FIELDS` entries (`:35`) with a help key (or map label→key) so the `.map` at `:163` can render `<HelpTooltip>` inside each label row. Wire the Start time label (`:183`) and the Expected finish label/`<span>` (`:198`) by hand. Place the affordance inside the existing label element's row, after the text, preserving the `htmlFor`→input association. Reference `FIELD_HELP` keys for: total_distance, elevation_gain, elevation_loss, hourly_fluid, hourly_carbs, hourly_sodium, start_time, expected_finish.

#### 2. AidStationManager field help

**File**: `src/components/plans/AidStationManager.tsx`

**Intent**: Add help to the cumulative distance / elevation gain / elevation loss / time-at-station fields in both the add form and the inline edit panel; skip Crew notes and facility checkboxes.

**Contract**: Wire the add-form labels (`:269`, `:286`, `:303`, `:320`) individually. For the edit panel, extend `EDIT_NUM_FIELDS` (`:31`) with a help key so the `.map` at `:433` renders `<HelpTooltip>` in each edit label — this covers the edit surface from the array. Reference `FIELD_HELP` keys: cumulative_distance, cumulative_gain, cumulative_loss, time_at_station.

#### 3. GearProfileForm field help

**File**: `src/components/plans/GearProfileForm.tsx`

**Intent**: Add help to the kind `<select>` and the per-kind fueling fields (carbs/sodium/fluid/capacity/carb ratio) in both the catalog rows and the add draft; skip Name.

**Contract**: Wire the Type `<select>` label (`:255`) with `FIELD_HELP.kind`. For the fueling fields, the labels come from `GEAR_FIELD_LABELS` and are rendered in two places — the row map (`:164`) and the add-draft map (`:289`). Render `<HelpTooltip>` in both label rows, keyed off the `field` value (carb_g, sodium_mg, fluid_ml, capacity_ml, carb_ratio) into `FIELD_HELP`. Consider a small local helper or a `field→helpKey` lookup so both maps stay in sync.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing Playwright suite passes: `npx playwright test`

#### Manual Verification:

- In a real plan, every non-obvious field in all three forms shows a "?" that opens on hover/focus/touch with correct copy
- Plan name, gear Name, Crew notes, and facility checkboxes have no "?"
- Tabbing reaches each "?" and the underlying input still focuses from its label
- No regression: autosave still fires on edits, add/delete still work, the AidStationManager edit panel still saves and validates distance

**Implementation Note**: Pause for manual confirmation after automated verification passes before proceeding.

---

## Phase 3: PlanTable headers

### Overview

Add help tooltips to the non-obvious computed column headers in the plan table's `<thead>`, clarifying what each output column means. Read-only surface — no editing affordances touched.

### Changes Required:

#### 1. PlanTable header help

**File**: `src/components/plans/PlanTable.tsx`

**Intent**: Add a "?" affordance to the headers whose meaning isn't obvious from the abbreviation — Time, Arrival, Fuel, and the three nutrient columns (which show achieved/target deltas) — while leaving Segment, Dist, Gain, Loss, and Aid station bare.

**Contract**: In the `<thead>` block (`:228`–`:238`), add `<HelpTooltip>` inside the relevant `<th>` after the header text. Reference `FIELD_HELP` keys: col_time (moving time, excludes station rest), col_arrival (clock time, includes rest), col_fuel (units to carry this segment), col_fluid / col_carbs / col_sodium (achieved vs target). The tooltip works the same in `readOnly` mode — header help is informational and unaffected by the editing toggle.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing Playwright suite passes: `npx playwright test`

#### Manual Verification:

- Hovering/focusing the Time, Arrival, Fuel, Fluid, Carbs, Sodium headers shows the correct explanation
- Segment, Dist, Gain, Loss, Aid station headers have no "?"
- Header tooltips appear in both the editable and read-only (S-04 shared view) renderings of the table
- Horizontal scroll / table layout is not broken by the added affordances

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Testing Strategy

### Unit Tests:

- No new unit-test infrastructure exists for components; rely on typecheck + the existing Playwright e2e suite. Optionally assert `FIELD_HELP` has a non-empty string for every wired key if a lightweight test fits the existing setup.

### Integration Tests:

- The existing `tests/` Playwright specs must continue to pass (no regression in autosave, add/edit/delete flows). Optionally add an assertion that a known "?" trigger is present and `aria-describedby` is wired on one representative field.

### Manual Testing Steps:

1. Open a plan in the editor; Tab from the top and confirm each non-obvious field's "?" is reachable and opens on focus.
2. Hover each "?" with a mouse; confirm copy is correct and dismisses on mouse-out.
3. On a touch viewport (or device emulation), tap a "?" and confirm the tooltip shows and dismisses.
4. Confirm skipped fields (Plan name, gear Name, Crew notes, facility checkboxes, obvious table columns) have no affordance.
5. Open the AidStationManager edit panel; confirm edit-field help shows and the panel still saves/validates.
6. View the plan table in read-only/shared mode; confirm header tooltips work.

## Performance Considerations

Negligible. Tooltips are lazy (content renders on open). One `TooltipProvider` per affordance is acceptable at this field count; if profiling ever flags it, hoist a single provider per form.

## Migration Notes

None — additive UI only, no data or schema changes.

## References

- Frame brief: `context/changes/tooltips/frame.md`
- Similar centralized label map: `src/lib/gear-kinds.ts:11`, `src/lib/aid-station-facilities.ts`
- Existing ui component convention: `src/components/ui/button.tsx`
- Target surfaces: `RaceSetupForm.tsx:35`, `AidStationManager.tsx:31`, `GearProfileForm.tsx:164`, `PlanTable.tsx:228`
- Convention: CLAUDE.md (shadcn new-york, `src/components/ui/`, `npx shadcn@latest add`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Primitive & foundation

#### Automated

- [x] 1.1 Type checking passes (`npx tsc --noEmit` / `npm run build`)
- [x] 1.2 Linting passes (`npm run lint`)
- [x] 1.3 Build succeeds (`npm run build`)
- [x] 1.4 tooltip.tsx, HelpTooltip.tsx, field-help.ts exist; `@radix-ui/react-tooltip` in package.json

#### Manual

- [ ] 1.5 HelpTooltip opens on hover, focus, and tap; Escape/blur dismisses
- [ ] 1.6 Tooltip content announced via aria-describedby; temporary render removed

### Phase 2: Input forms

#### Automated

- [ ] 2.1 Type checking passes (`npx tsc --noEmit`)
- [ ] 2.2 Linting passes (`npm run lint`)
- [ ] 2.3 Build succeeds (`npm run build`)
- [ ] 2.4 Existing Playwright suite passes (`npx playwright test`)

#### Manual

- [ ] 2.5 Every non-obvious field in all three forms shows correct help on hover/focus/touch
- [ ] 2.6 Skipped fields (Plan name, gear Name, Crew notes, facilities) have no "?"
- [ ] 2.7 Tab reaches each "?"; label still focuses its input
- [ ] 2.8 No regression in autosave, add/delete, and the aid-station edit panel save/validate

### Phase 3: PlanTable headers

#### Automated

- [ ] 3.1 Type checking passes (`npx tsc --noEmit`)
- [ ] 3.2 Linting passes (`npm run lint`)
- [ ] 3.3 Build succeeds (`npm run build`)
- [ ] 3.4 Existing Playwright suite passes (`npx playwright test`)

#### Manual

- [ ] 3.5 Time, Arrival, Fuel, Fluid, Carbs, Sodium headers show correct help
- [ ] 3.6 Segment, Dist, Gain, Loss, Aid station headers have no "?"
- [ ] 3.7 Header tooltips work in both editable and read-only table renderings
- [ ] 3.8 Table layout / horizontal scroll not broken

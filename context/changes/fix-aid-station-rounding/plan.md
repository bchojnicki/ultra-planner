# Fix unrounded aid-station distance/elevation Implementation Plan

## Overview

Aid-station cumulative distance and elevation render as raw full-precision floats (e.g. `10.123456 km`) in two UI surfaces — the read-only `AidStationList.astro` (view-plan mode) and the `AidStationManager` edit-panel inputs — because display rounding is hand-rolled per-component with no shared formatter, and these two surfaces never got it. The fix is a **display-layer** change: introduce one shared distance/elevation formatter, apply it everywhere, and seed the editable inputs rounded **without** quantizing the stored full-precision values. Storage, GPX import, zod, and the DB are out of scope (per the frame: storage keeps full precision — the "accuracy guardrail").

## Current State Analysis

From the frame brief (HIGH confidence) and code grounding:

- **No shared formatter exists.** `src/lib/utils.ts` only exports `cn`. Rounding is duplicated inline: `fmtKm`/`fmtM` defined locally in `PlanTable.tsx:42-48`, and `Math.round(...)` calls inline in `AidStationManager.tsx:408-411` (collapsed list line). `src/lib/plan-table.ts` is the calc lib, not a formatter.
- **`AidStationList.astro:26`** (read-only S-04 view) renders raw: `{s.cumulative_distance_km} km · {s.cumulative_elevation_gain_m} m gain`. It also omits elevation loss entirely.
- **`AidStationManager.tsx:182-184`** (`beginEdit`) seeds the edit draft via `String(s.cumulative_distance_km)` etc. — raw float → input value, no rounding.
- **`AidStationManager` save path**: `onDraftChange` (`:218-237`) and `endEdit` (`:242-263`) both call `buildPatch(draft)` (`:69-84`), which includes **every** valid numeric field regardless of whether the user changed it. So today, opening a station and closing it re-PATCHes the same values (a no-op write); with a rounded seed that would quantize stored precision.
- **Working convention**: `PlanTable` rounds via `fmtKm` (→ 0.1 km) / `fmtM` (→ whole m) at display; the segment calc keeps full precision. The plan table is correct and is the model to follow.

### Key Discoveries:

- `fmtKm`/`fmtM` are `PlanTable.tsx:42-48` (component-local), so they can't be imported by the `.astro` list — a shared module is required. Plain TS in `src/lib/format.ts` is importable by both `.tsx` and `.astro`.
- Distance rounds to 0.1 km (`Math.round(km * 10) / 10`); elevation to whole metres (`Math.round(m)`) — `PlanTable.tsx:42-47`, matched by `AidStationManager.tsx:408-411`.
- The edit save path must distinguish "user changed this field" from "seeded value" to avoid quantizing storage — the snapshot already tracked at `editSnapshot` (`AidStationManager.tsx:104,178,208`) plus the initial draft give the baseline to diff against.

## Desired End State

Every aid-station distance/elevation across the app displays rounded (0.1 km / whole m) via one shared formatter: the view-mode `AidStationList`, the `AidStationManager` collapsed line, the edit-panel inputs, and `PlanTable` (unchanged output, now sourced from the shared helper). Opening the edit panel shows rounded values; saving writes back **only** fields the user actually changed, so untouched stations retain full stored precision. No migration; stored data is untouched.

Verify: open a plan with a GPX-imported station carrying a long float — the view-mode list, collapsed editor line, and edit inputs all show the rounded value; the plan table is unchanged; editing only a facility flag and closing does **not** alter the station's stored distance/elevation.

## What We're NOT Doing

- Not rounding stored data, GPX import output, zod schemas, or DB columns — no migration (frame: storage keeps full precision).
- Not adding elevation loss to `AidStationList.astro` (it currently omits it) — rounding only what's already shown; field additions are out of scope.
- Not changing the rounding granularity (stays 0.1 km / whole m to match the existing convention).
- Not touching the add-station form inputs (they start empty; the user types values — no precision is manufactured there).
- Not altering the plan table's rendered output — only its formatter's source location.

## Implementation Approach

Two phases. Phase 1 is a pure display refactor with no behavior change: create `src/lib/format.ts`, point every read-only/display surface at it, and remove the duplicated inline rounding. Phase 2 makes the behavior-sensitive change to the editable inputs: seed them rounded and tighten the save path to only persist user-changed numeric fields, which both preserves stored precision and removes the existing no-op PATCH on open/close.

## Phase 1: Shared formatter + pure-display surfaces

### Overview

Create the single source of truth for distance/elevation display formatting and wire every display-only surface to it, fixing the read-only view-mode list and de-duplicating the existing inline rounding.

### Changes Required:

#### 1. Shared formatter module

**File**: `src/lib/format.ts` (new)

**Intent**: One home for distance/elevation display formatting, importable by both `.tsx` and `.astro`, mirroring the existing rounding so output is identical to today's `PlanTable`.

**Contract**: Export `fmtKm(km: number): string` (→ `Math.round(km * 10) / 10` as string, 0.1 km) and `fmtM(m: number): string` (→ `Math.round(m)` as string, whole m). Pure functions, no JSX. Behavior must match `PlanTable.tsx:42-48` exactly.

#### 2. Read-only view-mode list

**File**: `src/components/plans/AidStationList.astro`

**Intent**: Round the two values it already displays (distance, elevation gain) via the shared formatter — this is the primary reported bug surface.

**Contract**: Import `fmtKm`/`fmtM` from `@/lib/format`; wrap `s.cumulative_distance_km` and `s.cumulative_elevation_gain_m` at line 26. No new fields (loss stays omitted).

#### 3. PlanTable — source formatter from the shared module

**File**: `src/components/plans/PlanTable.tsx`

**Intent**: Remove the component-local `fmtKm`/`fmtM` and import them from the shared module, so there's a single definition. Rendered output is unchanged.

**Contract**: Delete the local `fmtKm`/`fmtM` definitions (`:42-48`); import from `@/lib/format`. All existing call sites (`:298-300`, `:368-370`) keep working unchanged.

#### 4. AidStationManager — collapsed line

**File**: `src/components/plans/AidStationManager.tsx`

**Intent**: Replace the inline `Math.round` rounding in the collapsed station summary with the shared formatter for consistency.

**Contract**: Use `fmtKm`/`fmtM` from `@/lib/format` at the collapsed line (`:408-411`), replacing the inline `Math.round(...)` expressions. Visible output unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing Playwright suite passes: `npx playwright test`

#### Manual Verification:

- View-plan mode: a GPX-imported station's distance/elevation now show rounded (0.1 km / whole m), not a long float
- Plan table output is visually identical to before
- The editor's collapsed station line is unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Edit-panel input — rounded seed + change-only PATCH

### Overview

Make the editable inputs show rounded values while protecting stored precision: seed the draft rounded, and persist a numeric field only when the user actually changed it from the seed.

### Changes Required:

#### 1. Round the edit-draft seed

**File**: `src/components/plans/AidStationManager.tsx`

**Intent**: Seed the edit-panel numeric inputs with rounded display values so the edit window stops showing long floats.

**Contract**: In `beginEdit` (`:181-195`), seed `cumulative_distance_km`, `cumulative_elevation_gain_m`, `cumulative_elevation_loss_m`, (and `time_spent_min` as today) using the shared `fmtKm`/`fmtM` instead of raw `String(...)`. The seeded strings become the baseline for the change-detection in change #2.

#### 2. Persist only user-changed numeric fields

**File**: `src/components/plans/AidStationManager.tsx`

**Intent**: Prevent a rounded seed from overwriting full-precision storage — a numeric field is included in the PATCH only when its current draft string differs from the seeded (rounded) string. This also eliminates the current no-op PATCH on open/close.

**Contract**: `buildPatch` (`:69-84`) must compare each numeric draft field against the seeded baseline and omit unchanged fields from the patch. Capture the seeded draft as the baseline (e.g. a ref set in `beginEdit` alongside `editSnapshot`). Both callers — `onDraftChange` (`:218-237`) and `endEdit` (`:242-263`) — go through this change-aware patch. Unchanged numeric fields are never sent; flags/notes behavior is unchanged. The optimistic in-place update and debounced save in `onDraftChange` continue to work; an unchanged numeric field simply isn't part of the patch.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing Playwright suite passes: `npx playwright test` (notably `tests/aid-station-edit.spec.ts`)

#### Manual Verification:

- Opening the edit panel shows rounded distance/elevation in the inputs (not a long float)
- Editing only a facility flag (or notes) and closing does NOT change the station's stored distance/elevation (verify the value is unchanged after reload)
- Actually editing a distance/elevation value still saves the new value correctly and re-sorts on close
- Distance validation (≤0, ≥ total, duplicate) still behaves as before
- No regression in autosave status indicator or the optimistic live-table update

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before closing the plan.

---

## Testing Strategy

### Unit Tests:

- Optional: a lightweight test that `fmtKm`/`fmtM` round to 0.1 km / whole m for representative inputs (the repo has vitest configured via `test:integration`).

### Integration Tests:

- The existing Playwright suite must stay green — especially `tests/aid-station-edit.spec.ts` (edit flow) and any plan-view spec that asserts station display text.

### Manual Testing Steps:

1. Import a GPX that produces long-float station distances; open the plan in edit mode — collapsed line and edit inputs show rounded values.
2. Open the same plan in view-plan (read-only) mode — the aid-station list shows rounded values.
3. Confirm the plan table output is unchanged.
4. In edit mode, toggle a facility flag on a station and close; reload and confirm the station's distance/elevation are byte-for-byte the stored full-precision values (not quantized).
5. In edit mode, change a station's distance to a new value and close; confirm it saves and the list re-sorts.

## Performance Considerations

Negligible — pure formatting and a string comparison in the save path.

## Migration Notes

None — no data or schema changes. Stored values are untouched; rounding is display-only.

## References

- Frame brief: `context/changes/fix-aid-station-rounding/frame.md`
- Display rounding convention: `src/components/plans/PlanTable.tsx:42-48`
- Reported surfaces: `src/components/plans/AidStationList.astro:26`, `src/components/plans/AidStationManager.tsx:182-184,408-411`
- Save path: `src/components/plans/AidStationManager.tsx:69-84,218-263`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared formatter + pure-display surfaces

#### Automated

- [x] 1.1 Type checking passes (`npx astro check`)
- [x] 1.2 Linting passes (`npm run lint`)
- [x] 1.3 Build succeeds (`npm run build`)
- [x] 1.4 Existing Playwright suite passes (`npx playwright test`)

#### Manual

- [x] 1.5 View-plan mode shows rounded station distance/elevation (not a long float)
- [x] 1.6 Plan table output visually identical to before
- [x] 1.7 Editor collapsed station line unchanged

### Phase 2: Edit-panel input — rounded seed + change-only PATCH

#### Automated

- [ ] 2.1 Type checking passes (`npx astro check`)
- [ ] 2.2 Linting passes (`npm run lint`)
- [ ] 2.3 Build succeeds (`npm run build`)
- [ ] 2.4 Existing Playwright suite passes (`npx playwright test`)

#### Manual

- [ ] 2.5 Edit panel inputs show rounded distance/elevation
- [ ] 2.6 Editing only a flag/notes and closing does NOT change stored distance/elevation
- [ ] 2.7 Editing a distance/elevation value still saves correctly and re-sorts
- [ ] 2.8 Distance validation + autosave/optimistic update unaffected

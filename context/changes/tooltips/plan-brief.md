# On-hover field-help tooltips — Plan Brief

> Full plan: `context/changes/tooltips/plan.md`
> Frame brief: `context/changes/tooltips/frame.md`

## What & Why

The plan-builder forms expose domain inputs (cumulative measurements, hourly nutrition targets, carb ratio, calibration) with no in-app explanation, so a runner unfamiliar with the model can't tell what to enter or why — and there's no help primitive in the UI to hang an explanation on. We add a reusable, accessible "?" help affordance after non-obvious field labels.

## Starting Point

No tooltip primitive exists (`src/components/ui/` has only `button.tsx`; `@radix-ui/react-slot` is the only Radix dep). All form labels share one pattern, and label metadata is already centralized in `src/lib/gear-kinds.ts` / `aid-station-facilities.ts` — a `field-help` map fits that exact precedent.

## Desired End State

Each non-obvious field across `RaceSetupForm`, `AidStationManager`, `GearProfileForm`, and the `PlanTable` headers shows a "?" icon-button after its label that reveals a short explanation on hover, keyboard-focus, and touch — dismissible with Escape/blur, announced to screen readers via `aria-describedby`. No data, API, or persistence changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Tooltip primitive | shadcn `tooltip` (Radix) | Radix handles focus/touch/escape/positioning the a11y goal requires; matches the shadcn setup | Frame |
| Interaction / a11y | Hover + keyboard-focus + touch | A runner may plan on a tablet; keyboard users must reach the hint | Frame |
| Coverage | Non-obvious fields only | Hints where the model isn't self-evident; skip Plan name, Crew notes, etc. | Frame |
| Affordance | Separate "?" icon button after the label | Own tab stop + `aria-describedby` is the cleanest keyboard/touch a11y; preserves label→input wiring | Plan |
| Copy location | Central `src/lib/field-help.ts` map | One authored, testable source of truth; mirrors gear-kinds.ts convention | Plan |

## Scope

**In scope:** A `HelpTooltip` component on the shadcn tooltip primitive; a central copy map; help wired into the non-obvious fields of the three input forms and the non-obvious plan-table headers.

**Out of scope:** Self-evident fields; any data/API/validation/autosave change; custom or `title`-based tooltips; a global help page or onboarding tour; i18n.

## Architecture / Approach

`HelpTooltip` (in `src/components/ui/`) owns the `TooltipProvider`, the icon-button trigger, accessibility wiring, and styling — so each call site is a one-liner `<HelpTooltip text={FIELD_HELP.key} label="…" />` placed in the label row. Copy lives in `src/lib/field-help.ts`. The three forms and the plan table are independently-hydrated React islands, so the provider lives inside `HelpTooltip` (one per affordance) rather than a single app-root provider.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Primitive & foundation | shadcn tooltip + `HelpTooltip` + `field-help.ts` map | Radix provider placement in islands; getting a11y/touch right |
| 2. Input forms | Help wired into RaceSetupForm, AidStationManager (add + edit), GearProfileForm | Keeping shared label maps (gear, edit-fields) in sync; no autosave/edit regression |
| 3. PlanTable headers | Tooltips on Time/Arrival/Fuel/nutrient columns | Table layout / horizontal scroll; works in read-only view |

**Prerequisites:** None beyond a working dev environment; `npx shadcn@latest add tooltip` runs in Phase 1.
**Estimated effort:** ~1–2 sessions across 3 phases (small, additive).

## Open Risks & Assumptions

- Radix `TooltipProvider` must wrap every tooltip; per-island hydration means one provider per affordance (acceptable at this field count).
- The "?" button adds one tab stop per helped field — intended, for keyboard reachability.
- Help copy is authored in Phase 1; quality of the explanations is a content concern, refined during manual review.

## Success Criteria (Summary)

- Every non-obvious field shows a "?" that opens on hover/focus/touch with correct copy; skipped fields have none.
- Keyboard and screen-reader users can reach and read every hint; label→input focus still works.
- No regression in autosave, add/edit/delete, or the plan table (editable and read-only).

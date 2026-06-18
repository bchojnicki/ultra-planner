# Frame Brief: On-hover field-help tooltips

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.
>
> Design-shape frame (a UX enhancement with open design choices), not bug-shape.
> No malfunction to trace, so no hypothesis agents were spawned (guardrail #6);
> the work was grounding the design space in the code and settling the choices.

## Reported Observation

Plan form fields have bare labels and no in-app explanation. A runner may not know
what "cumulative" distance means vs a segment, what the hourly fluid/carb/sodium
targets drive, what "expected finish" feeds, or how GPX calibration works — and
there is no help affordance anywhere in the UI.

## Initial Framing (preserved)

- **User's stated cause or approach**: Add a small "?" affordance per field that shows a short hint on hover.
- **User's proposed direction**: A reusable HelpTooltip component + hover hints across the plan forms.
- **Pre-dispatch narrowing**: coverage = **non-obvious fields only**; interaction = **hover + keyboard-focus + touch**; primitive = deferred ("not sure" → recommend).

## Dimension Map

Design axes (all grounded in the current code):

1. **Tooltip primitive** — none exists: `src/components/ui/` has only `button.tsx`; the sole Radix dep is `@radix-ui/react-slot`. Options: shadcn `tooltip` (Radix) vs lightweight custom vs native `title`.  ← key decision
2. **Help-copy location** — a central `field-help` map vs inline strings per field.
3. **Interaction / a11y** — hover-only vs hover + focus + touch.
4. **Coverage** — every field vs only the non-obvious ones.

## Hypothesis Investigation

No cause hypotheses (additive UX feature). Design axes resolved to decisions:

| Axis | Decision | Grounding | Verdict |
| --- | --- | --- | --- |
| Interaction / a11y | **Hover + keyboard-focus + touch** | User choice; a runner may plan on a tablet, and keyboard users must reach the hint | SETTLED |
| Primitive | **shadcn `tooltip` (Radix)** — recommended | The a11y requirement decides it: Radix handles focus/touch/escape/positioning correctly; custom would re-implement that (easy to get wrong) and native `title` can't do styled touch. Matches the shadcn/new-york setup (CLAUDE.md); install via `npx shadcn@latest add tooltip` | SETTLED (user deferred → a11y constraint resolves) |
| Coverage | **Non-obvious fields only** | User choice — hints on cumulative-vs-segment distance, hourly targets, expected finish, calibration; skip self-evident fields (Plan name) | SETTLED |
| Copy location | **Central field-help map** (plan to confirm) | One place to author/maintain copy, testable, keeps JSX clean; finalize in /10x-plan | RECOMMENDED |

## Narrowing Signals

- a11y = **hover + focus + touch** → rules out hover-only and native `title`; effectively selects the Radix primitive.
- coverage = **non-obvious only** → the plan must enumerate which fields qualify, not blanket every input.
- primitive deferred → frame records the recommendation (shadcn tooltip) with rationale; user confirms at plan time if they disagree.

## Cross-System Convention

The project is shadcn/ui "new-york" (CLAUDE.md), components live in
`src/components/ui/`, installed via `npx shadcn@latest add [name]`. A Radix tooltip
is the convention-fit primitive; `@radix-ui/react-slot` is already present, so the
Radix family is already in the tree. No precedent for custom popovers or `title`-based
help in this repo.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the plan forms expose domain inputs
> (cumulative measurements, hourly targets, calibration) with no in-app
> explanation, so a runner unfamiliar with the model can't tell what to enter or
> why — and there is no help primitive in the UI to hang an explanation on.

The initial framing was correct — proceed with the proposed direction. The frame's
value was settling the design: an accessible (hover/focus/touch) shadcn Radix
tooltip behind a reusable help affordance, copy in a central map, applied to the
non-obvious fields only.

## Confidence

**HIGH** — additive UX feature on a known surface; every axis decided (primitive
follows deterministically from the chosen a11y requirement and the shadcn stack).
No reproduction needed. The only open detail is the exact field list + copy, which
is plan-level work, not a framing risk.

## What Changes for /10x-plan

Plan a reusable help affordance built on shadcn `tooltip` (Radix), accessible on
hover/focus/touch, with help copy in a central map, applied to a curated set of
non-obvious fields across `RaceSetupForm` / `AidStationManager` / `GearProfileForm`
(and any non-obvious `PlanTable` column headers). First step is adding the tooltip
primitive (`npx shadcn@latest add tooltip`).

## References

- Source: `src/components/ui/` (only `button.tsx` — no tooltip), `package.json` (`@radix-ui/react-slot` only)
- Forms: `src/components/plans/RaceSetupForm.tsx` (`NUMERIC_FIELDS`), `AidStationManager.tsx`, `GearProfileForm.tsx`, `PlanTable.tsx`
- Convention: CLAUDE.md (shadcn new-york, `src/components/ui/`, `npx shadcn@latest add`)
- Investigation tasks: none (design-shape frame)

# Collapsible (Roll-Up) Plan-Builder Sections — Plan Brief

> Full plan: `context/changes/collapsible-plan-sections/plan.md`

## What & Why

Make the three plan-builder input sections — **Race parameters**, **Gear**, and **Aid stations** — collapsible so runners can roll them up and cut scrolling on long plans. Today all three are always fully expanded, and a plan with many gear items and aid stations forces a lot of scrolling to reach the computed plan table.

## Starting Point

The plan editor mounts one React island, `PlanEditor.tsx`, rendering four children in order: `RaceSetupForm`, `GearProfileForm`, `AidStationManager`, and `PlanTable`. The three input forms each own a near-identical `<section>` shell + `<h2>` header. `RaceSetupForm`'s header also carries a live save-status indicator, and both `RaceSetupForm` and `AidStationManager` are remounted (via a `key` bump) after a GPX import. No `localStorage` is used anywhere yet; `aria-expanded` disclosure is already an established pattern in the codebase.

## Desired End State

Each input section has a clickable header bar with a rotating chevron that rolls its body up/down. The collapsed/expanded state is remembered per-plan across reloads and survives a GPX import. The Race-parameters save-status stays visible and live even when collapsed. The `PlanTable` output is untouched and always visible.

## Key Decisions Made

| Decision               | Choice                                              | Why (1 sentence)                                                              | Source |
| ---------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Architecture           | Shared `CollapsibleSection` wrapper                 | Three sections share an identical shell — one wrapper gives DRY, consistent a11y. | Plan   |
| Default + persistence  | Expanded by default; persist per-section in `localStorage` | No first-use surprise; rolled-up layout survives reloads for the stated goal. | Plan   |
| Scope                  | Three input sections only (not `PlanTable`)         | Matches the task; the output is what runners want on screen while collapsing inputs. | Plan   |
| Affordance             | Full header is the toggle button + rotating chevron | Large hit target, standard disclosure a11y, matches existing `aria-expanded` style. | Plan   |
| Import remount         | Wrapper sits outside the `key`, owns the state      | Import doesn't disturb the runner's rolled-up layout.                          | Plan   |

## Scope

**In scope:** Collapsible Race parameters / Gear / Aid stations; per-plan persistence; full-header disclosure a11y; preserving Race save-status while collapsed; Playwright coverage.

**Out of scope:** Collapsing `PlanTable`; a global collapse-all control; server-side/cross-device persistence; any change to section internals (autosave, GPX, gear allocation), data model, or API.

## Architecture / Approach

A new presentational `CollapsibleSection` wraps the shared `<section>` shell and renders a disclosure header (`<button aria-expanded aria-controls>` around the `<h2>` + `ChevronDown`) and a collapsible body. A small SSR-safe `useCollapsed(storageKey)` hook owns the boolean, defaulting to expanded and reading `localStorage` in a mount effect to avoid hydration mismatch. The three forms drop their own shell/header and render their bodies inside the wrapper, composed from `PlanEditor` — with the existing `key` kept on the inner form so the wrapper (and its collapse state) survives import remounts. Race save-status moves into a header slot beside the button.

## Phases at a Glance

| Phase                                        | What it delivers                                            | Key risk                                                        |
| -------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Shared wrapper + persistence hook         | `CollapsibleSection` + `useCollapsed` with disclosure a11y  | SSR/hydration mismatch from reading `localStorage` during render |
| 2. Integrate into the three sections         | Shells stripped, composed in `PlanEditor`, Playwright tests | Save-status threading; preserving collapse state across remount |

**Prerequisites:** None — `lucide-react@1.14.0` is already a dependency.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- `localStorage` is SSR-safe only if state initializes to the default and reads storage in a post-mount effect — otherwise hydration errors on the `client:load` island.
- The Race save-status live region must render outside the toggle button or it breaks the button's accessible name / live announcements.
- Assumes per-plan, per-section persistence (not global, not cross-device) is the desired granularity.

## Success Criteria (Summary)

- A runner can roll up any of the three input sections and the layout is remembered on reload and after a GPX import.
- Collapsing a section never hides or silences the Race save-status, and never disturbs autosave/GPX/gear behavior.
- Disclosure is keyboard- and screen-reader-correct; no spacing regression and the plan table stays visible.

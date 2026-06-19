# Collapsible (Roll-Up) Plan-Builder Sections Implementation Plan

## Overview

Let runners collapse and expand the three plan-builder input sections — **Race parameters**, **Gear**, and **Aid stations** — to cut scrolling on long plans. A single shared `CollapsibleSection` wrapper owns the section shell and the disclosure header (a full-width toggle button with a rotating chevron and correct `aria-expanded`/`aria-controls`). Each section's collapsed state persists per-plan in `localStorage` so a runner's rolled-up layout survives reloads and the GPX-import remount. The computed `PlanTable` output stays always-visible.

## Current State Analysis

The plan editor mounts a single React island, `PlanEditor.tsx` (`client:load`, from `src/pages/plans/[id]/edit.astro`), which renders four children in order: `RaceSetupForm`, `GearProfileForm`, `AidStationManager`, and `PlanTable`.

Each of the three input sections currently owns its own `<section>` shell and `<h2>` heading with near-identical styling:

- `RaceSetupForm.tsx:138` — `<section className="mb-6 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">`, and its header is a flex row (`RaceSetupForm.tsx:139`) holding `<h2>Race parameters</h2>` **plus** a live `aria-live="polite"` save-status span (`Saving…/Saved/…`).
- `GearProfileForm.tsx:251` — same shell with `mb-6`; header is `<h2 className="mb-1">Gear</h2>` immediately followed by a descriptive `<p>` (`GearProfileForm.tsx:252-256`).
- `AidStationManager.tsx:284` — same shell **without** `mb-6` (it is the last input section before the table); header is a plain `<h2 className="mb-4">Aid stations</h2>`.

Key constraints discovered:

- **GPX-import remount.** On a successful import, `PlanEditor` bumps `importKey`, which changes the `key` on `RaceSetupForm` (`PlanEditor.tsx:152`) and `AidStationManager` (`PlanEditor.tsx:160`), remounting them so they re-seed from the imported plan. `GearProfileForm` is **not** keyed. Any collapse state held *inside* a re-keyed child would reset on import.
- **Disclosure house style exists.** `aria-expanded` is already used at `AidStationManager.tsx:440` and `PlanTable.tsx:280` — there is a precedent to match (button + `aria-expanded`).
- **No `localStorage` usage anywhere** in `src/` today. This change introduces the first instance; it must be SSR-safe (the island is `client:load`, but code must not touch `window`/`localStorage` during the initial render pass on the server).
- **`lucide-react@1.14.0`** is a dependency (currently unused in `src/`); `ChevronDown` is the natural chevron icon.
- `cn()` from `@/lib/utils` is the established class-merging helper.

## Desired End State

Each of the three input sections renders a clickable header bar (the whole `<h2>` row is a button) with a chevron that rotates to indicate open/closed. Clicking (or activating via keyboard) rolls the section body up or down. The Race-parameters save-status indicator remains visible and live in the header regardless of collapse state. On reload, each section restores the collapsed/expanded state the runner last left it in for that plan; a GPX import does not disturb it. The `PlanTable` output is unaffected and always visible.

Verify by: collapsing each section, reloading the page (state restored), running a GPX import (collapse state for Race/Aid sections preserved), and tabbing to each header to confirm keyboard + screen-reader disclosure semantics.

### Key Discoveries:

- Three sections share an identical shell modulo the trailing margin (`AidStationManager` omits `mb-6`) — a single wrapper with a margin/`className` prop covers all three (`RaceSetupForm.tsx:138`, `GearProfileForm.tsx:251`, `AidStationManager.tsx:284`).
- `RaceSetupForm`'s header carries interactive-adjacent **live** content (save-status span, `RaceSetupForm.tsx:141`); it cannot be nested inside the toggle `<button>` and must be passed as a separate header slot rendered beside the button.
- The wrapper must sit **outside** the re-keyed children in `PlanEditor` so collapse state survives the import remount (`PlanEditor.tsx:152,160`).
- Persistence must be SSR-safe and keyed by plan id + a stable section key so two plans don't share collapse state.

## What We're NOT Doing

- Not making `PlanTable` (the computed output) collapsible — it stays always-visible.
- Not adding a global "collapse all / expand all" control.
- Not changing any section's internal behavior (autosave, add/delete rows, GPX import, gear allocation).
- Not introducing a design-system/Collapsible primitive from a new library — the wrapper is local and built on the existing `aria-expanded` pattern.
- Not persisting collapse state server-side or syncing it across devices — `localStorage` only.
- Not touching the data model, API routes, or auth.

## Implementation Approach

Extract the repeated section shell into one presentational wrapper, `CollapsibleSection`, that renders `<section>` → header `<button>` (toggle, with chevron + `aria-expanded`/`aria-controls`) → collapsible body region. Collapsed state is owned by a tiny `useCollapsed` hook backed by `localStorage` (SSR-safe, default expanded). Strip the `<section>`/`<h2>` shell out of the three form components so they render only their body content, and compose them inside `CollapsibleSection` from `PlanEditor`, where the wrapper sits outside the existing `key` so import remounts don't reset collapse state. `RaceSetupForm`'s save-status moves into a header slot.

## Critical Implementation Details

- **SSR safety for persistence.** The island is `client:load`, so the first client render must match the server's HTML to avoid a hydration mismatch. Initialize `useCollapsed` to the default-expanded state and read `localStorage` in an effect after mount (then update state), rather than reading `localStorage` during render. A brief expanded-first paint is acceptable and avoids hydration errors.
- **Live region must stay outside the button.** The Race-parameters `aria-live="polite"` save-status must render as sibling header content next to the toggle button — never inside it — so it keeps announcing and so the button's accessible name stays clean.
- **Wrapper placement vs. `key`.** In `PlanEditor`, the `key={`race-${importKey}`}` / `key={`stations-${importKey}`}` must remain on the inner form, with `CollapsibleSection` as the unkeyed parent; otherwise the wrapper remounts on import and collapse state flickers/resets.

## Phase 1: Shared `CollapsibleSection` wrapper + persistence hook

### Overview

Build the reusable wrapper and the persistence hook, with correct disclosure a11y, independent of the three sections. Nothing is wired in yet.

### Changes Required:

#### 1. Collapsed-state hook

**File**: `src/components/hooks/useCollapsed.ts` (new)

**Intent**: Own the per-section collapsed boolean and persist it to `localStorage`, SSR-safe, defaulting to expanded. Extracted to `src/components/hooks/` per the repo's hook convention.

**Contract**: Export `useCollapsed(storageKey: string): [collapsed: boolean, toggle: () => void]` (or `setCollapsed`). State initializes to `false` (expanded) for a server/client-matching first render; a mount effect reads `localStorage.getItem(storageKey)` and, if present, syncs state; `toggle` writes the new value back. All `localStorage` access guarded for absence (wrapped in `try/catch` and a `typeof window` check) so it is inert during SSR and resilient to disabled storage.

#### 2. CollapsibleSection wrapper

**File**: `src/components/plans/CollapsibleSection.tsx` (new)

**Intent**: Render the shared section shell with a disclosure header (full-width toggle button + rotating chevron) and a collapsible body. Replaces the hand-rolled `<section>`/`<h2>` shell the three forms each carry today.

**Contract**: Props — `title: string`, `storageKey: string`, `children: ReactNode`, optional `headerExtra?: ReactNode` (rendered beside the title, outside the button — for the save-status span), optional `className?: string` (for the trailing-margin difference). Renders `<section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl", className)}>`. Header is a `<button type="button" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle}>` wrapping the `<h2>` and a `ChevronDown` from `lucide-react` with a `cn(...,"rotate-…")` transform when collapsed; `headerExtra` renders as a sibling of the button inside the flex header row. Body is a region `<div id={bodyId}>` rendered only when expanded (or hidden via `hidden`), with the `bodyId` matching `aria-controls`. Uses `useCollapsed(storageKey)`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- (Deferred to Phase 2 — the wrapper is not rendered anywhere until integrated.)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes live in the `## Progress` section at the bottom.

---

## Phase 2: Integrate the wrapper into the three sections

### Overview

Remove the `<section>`/`<h2>` shell from each of the three forms, render them inside `CollapsibleSection` in `PlanEditor` (outside the existing `key`), thread the Race save-status into the header slot, preserve the per-section trailing margin, and add Playwright coverage.

### Changes Required:

#### 1. RaceSetupForm — strip shell, surface save-status for the header slot

**File**: `src/components/plans/RaceSetupForm.tsx`

**Intent**: Replace the outer `<section>` + flex header (`RaceSetupForm.tsx:138-144`) with a fragment/plain container holding just the form body, so the shell and title come from `CollapsibleSection`. The save-status indicator must become available to the wrapper's `headerExtra` slot.

**Contract**: Remove the `<section>` wrapper and the `<h2>Race parameters</h2>` header row; keep the GPX control and the field grid as the body. Expose save status to the parent — simplest path: keep the existing internal `status`/`STATUS_TEXT` but render the save-status `<span data-testid="save-status" aria-live="polite">` at the top of the body (or lift status up); the chosen approach must keep `data-testid="save-status"` present and live. The implementer picks between rendering the span in-body vs. lifting `status` to `PlanEditor` for the `headerExtra` slot — favor the in-body option if lifting state would complicate autosave wiring.

#### 2. GearProfileForm — strip shell

**File**: `src/components/plans/GearProfileForm.tsx`

**Intent**: Remove the outer `<section>` and `<h2>Gear</h2>` (`GearProfileForm.tsx:251-252`); the descriptive `<p>` (`GearProfileForm.tsx:253-256`) stays at the top of the body.

**Contract**: Body = everything currently inside the `<section>` except the `<h2>`. Title "Gear" is supplied via the wrapper's `title` prop in `PlanEditor`.

#### 3. AidStationManager — strip shell

**File**: `src/components/plans/AidStationManager.tsx`

**Intent**: Remove the outer `<section>` and `<h2>Aid stations</h2>` (`AidStationManager.tsx:284-285`); render the rest as the body.

**Contract**: Body = current section contents minus the `<h2>`. Title "Aid stations" supplied via the wrapper. This section's shell omitted `mb-6`; that margin difference is handled by the wrapper `className` prop in `PlanEditor` (see change 4).

#### 4. PlanEditor — compose the wrappers

**File**: `src/components/plans/PlanEditor.tsx`

**Intent**: Wrap each of the three forms in `CollapsibleSection`, keeping the existing `key` on the inner form so import remounts don't reset collapse state. Supply title, a plan-scoped `storageKey`, and the trailing-margin `className`.

**Contract**: Three wrappers around `PlanEditor.tsx:151-165`:
- Race: `<CollapsibleSection title="Race parameters" storageKey={`collapse:${plan.id}:race`} className="mb-6" headerExtra={…save-status if lifted…}>` with `<RaceSetupForm key={`race-${importKey}`} … />` inside.
- Gear: `storageKey={`collapse:${plan.id}:gear`} className="mb-6"` wrapping `<GearProfileForm … />`.
- Aid: `storageKey={`collapse:${plan.id}:stations`}` (no `mb-6`) wrapping `<AidStationManager key={`stations-${importKey}`} … />`.
The `CollapsibleSection` element itself carries no `key`; the inner forms keep theirs.

#### 5. Playwright coverage

**File**: `tests/collapsible-sections.spec.ts` (new, alongside `tests/auth.spec.ts`)

**Intent**: Cover the core behaviors: toggle collapses/expands a section, state persists across reload, and the Race save-status stays present when its section is collapsed.

**Contract**: Authenticated test (reuse the auth setup pattern from `tests/auth.spec.ts`) navigating to a plan's `/plans/[id]/edit`. Assert: clicking a section header toggles `aria-expanded` and hides/shows the body; reloading restores the collapsed state; `data-testid="save-status"` is still in the DOM with Race collapsed. Keep selectors resilient (role/name based).

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `npx astro sync && npm run lint`
- Production build succeeds: `npm run build`
- Playwright suite passes: `npx playwright test`

#### Manual Verification:

- Each of the three sections collapses and expands on header click; chevron rotates.
- Collapsed state survives a full page reload (per-section, per-plan).
- A GPX import preserves the collapsed state of Race parameters and Aid stations (no flicker/reset).
- Race-parameters save-status remains visible and updates (`Saving…/Saved`) while the section is collapsed.
- Keyboard: header is focusable, Enter/Space toggles; screen reader announces expanded/collapsed via `aria-expanded`.
- No layout regression — spacing between sections matches the prior design (Aid stations has no extra bottom margin before the table).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that manual testing succeeded.

---

## Testing Strategy

### Unit Tests:

- None added (the project uses Playwright e2e, no unit runner is configured). Behavior is covered via the e2e spec.

### Integration Tests:

- `tests/collapsible-sections.spec.ts`: toggle, persistence-across-reload, save-status-while-collapsed (see Phase 2, change 5).

### Manual Testing Steps:

1. Open a plan at `/plans/[id]/edit`; confirm all three sections render expanded on first visit.
2. Collapse each section; confirm chevron rotates and body hides.
3. Reload; confirm each section restores its last collapsed/expanded state.
4. Import a GPX file; confirm Race + Aid collapse state is preserved.
5. Collapse Race parameters, edit a field elsewhere that triggers autosave; confirm save-status still shows in the collapsed header.
6. Tab to each header, toggle with keyboard; verify with a screen reader.

## Performance Considerations

Negligible — collapse is local component state plus a single `localStorage` read on mount and a write on toggle. Collapsed bodies can be unmounted (or `hidden`); unmounting trades a small remount cost on expand for less DOM, which is fine at this scale.

## Migration Notes

No data migration. The new `localStorage` keys (`collapse:<plan-id>:<section>`) are created lazily and default to expanded when absent, so existing users see no change until they collapse something.

## References

- Island root / composition: `src/components/plans/PlanEditor.tsx:144-176`
- Section shells: `src/components/plans/RaceSetupForm.tsx:138`, `src/components/plans/GearProfileForm.tsx:251`, `src/components/plans/AidStationManager.tsx:284`
- Existing `aria-expanded` precedent: `src/components/plans/AidStationManager.tsx:440`, `src/components/plans/PlanTable.tsx:280`
- Hook convention: `src/components/hooks/useAutosave.ts`
- Class-merge helper: `src/lib/utils.ts` (`cn`)
- Change identity: `context/changes/collapsible-plan-sections/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared CollapsibleSection wrapper + persistence hook

#### Automated

- [x] 1.1 Type checking passes: `npx astro sync && npm run lint`
- [x] 1.2 Production build succeeds: `npm run build`

### Phase 2: Integrate the wrapper into the three sections

#### Automated

- [ ] 2.1 Type checking + lint pass: `npx astro sync && npm run lint`
- [ ] 2.2 Production build succeeds: `npm run build`
- [ ] 2.3 Playwright suite passes: `npx playwright test`

#### Manual

- [ ] 2.4 Each section collapses/expands on header click; chevron rotates
- [ ] 2.5 Collapsed state survives a full page reload (per-section, per-plan)
- [ ] 2.6 GPX import preserves Race + Aid collapse state (no flicker/reset)
- [ ] 2.7 Race save-status visible and updating while its section is collapsed
- [ ] 2.8 Keyboard focus + Enter/Space toggle; screen reader announces state
- [ ] 2.9 No spacing regression between sections

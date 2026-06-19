# Fix unrounded aid-station distance/elevation — Plan Brief

> Full plan: `context/changes/fix-aid-station-rounding/plan.md`
> Frame brief: `context/changes/fix-aid-station-rounding/frame.md`

## What & Why

Display rounding for aid-station distance/elevation is hand-rolled per-component with no shared formatter, so the read-only `AidStationList.astro` and the editable edit-panel inputs render the raw stored float (e.g. `10.123456 km`) while `PlanTable` and the editor summary round. The fix is a single shared display formatter applied at every aid-station surface — **not** rounding the stored data.

## Starting Point

`fmtKm`/`fmtM` exist only inline in `PlanTable.tsx:42-48`; `AidStationManager` rounds its collapsed line with inline `Math.round`; `AidStationList.astro:26` and the edit-panel seed (`beginEdit`, `:182-184`) render raw floats. The save path (`buildPatch`) PATCHes every numeric field on any edit, including no-op open/close.

## Desired End State

Every aid-station distance/elevation displays rounded (0.1 km / whole m) via one shared formatter — view-mode list, collapsed editor line, edit inputs, and the (unchanged) plan table. The edit inputs show rounded values, but saving writes back only fields the user actually changed, so untouched stations keep full stored precision. No migration.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Layer | Display-only; storage keeps full precision | Matches the "accuracy guardrail"; no migration | Frame |
| Edit-input precision | Round seed + PATCH only changed fields | Shows rounded without quantizing storage; also kills the no-op PATCH | Plan |
| De-duplication scope | Consolidate into one shared `src/lib/format.ts` | Single source of truth; stops the next surface drifting | Plan |
| Formatter home | New `src/lib/format.ts` (plain TS) | Importable by both `.tsx` and `.astro` (the Astro list needs it) | Plan |

## Scope

**In scope:** `src/lib/format.ts` (new `fmtKm`/`fmtM`); wire `AidStationList.astro`, `PlanTable` (source from shared), `AidStationManager` collapsed line + edit-panel seed; change-aware save path.

**Out of scope:** rounding stored data / GPX import / zod / DB / migration; adding elevation loss to the view list; changing rounding granularity; the add-station form.

## Architecture / Approach

A plain-TS `src/lib/format.ts` becomes the one definition of `fmtKm` (0.1 km) / `fmtM` (whole m), matching today's `PlanTable` output. Phase 1 wires all display surfaces to it (pure refactor, no behavior change). Phase 2 seeds the editable inputs rounded and makes `buildPatch` diff each numeric field against the rounded seed baseline so only user-changed fields are persisted.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared formatter + display surfaces | `format.ts` + rounded view-list, deduped PlanTable & collapsed line | Touching working PlanTable formatting (output must stay identical) |
| 2. Edit-panel rounded seed + change-only PATCH | Rounded edit inputs that don't quantize storage | Save-path change must not break autosave/validation/re-sort |

**Prerequisites:** None.
**Estimated effort:** ~1 session across 2 phases (small).

## Open Risks & Assumptions

- The change-aware `buildPatch` must preserve existing autosave, optimistic in-place update, distance validation, and re-sort-on-close behavior.
- Rounding granularity (0.1 km / whole m) is assumed correct — it mirrors the existing `PlanTable` convention.

## Success Criteria (Summary)

- View-mode list and edit inputs show rounded distance/elevation; plan table output unchanged.
- Editing only a flag/notes leaves the station's stored distance/elevation untouched (full precision preserved).
- Editing a distance/elevation still saves and re-sorts correctly; validation and autosave unaffected.

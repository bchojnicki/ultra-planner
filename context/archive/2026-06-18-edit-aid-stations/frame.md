# Frame Brief: Edit an existing aid station

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.
>
> Note: this is a **design-shape** frame (a PRD-backed feature with open design
> choices), not a bug-shape one. There is no malfunction to trace, so no parallel
> hypothesis agents were spawned (guardrail #6). The work was scoping the design
> space against the current code and settling four real tradeoffs with the user.

## Reported Observation

Aid stations can be **added** and **deleted** but never **edited** after creation.
GPX waypoint import (change `gpx-import`) creates stations with only
distance / elevation / name — no facilities, planned time, or crew notes — and
there is no way to enrich them short of delete-and-re-add.

## Initial Framing (preserved)

- **User's stated cause or approach**: Add an "edit aid station" capability per PRD **US-10 / FR-007** (added in PRD v5).
- **User's proposed direction**: Wire the existing `updateAidStation` service fn to a new PATCH endpoint + an edit UI in `AidStationManager`.
- **Pre-dispatch narrowing**: scoping answers below (inline-expand · all fields · uniform · autosave) — settled directly, since the premise needed no challenge.

## Dimension Map

Design axes the feature could be cut along (all grounded in current code):

1. **Edit affordance (UI)** — `AidStationManager.tsx` is a top add-form + read-only rows w/ per-row delete. Inline-expand vs modal vs reuse-the-top-form.  ← decision point
2. **Field scope** — all fields vs an "enrichment" subset (time/facilities/notes), leaving measurement fields read-only.
3. **Endpoint + validation** — `/api/aid-stations/[id].ts` currently has DELETE only; add PATCH + a new `aidStationUpdateSchema`.
4. **Post-edit behavior** — re-sort on distance change, recompute segments, prune stale gear selections, save model.
5. **GPX angle** — uniform edit for all stations vs a special nudge for bare imports.

## Hypothesis Investigation

No cause hypotheses (additive feature). Instead, the design axes resolved to
decisions, each grounded in an existing pattern:

| Axis | Decision | Grounding | Verdict |
| --- | --- | --- | --- |
| Affordance | **Inline-expand row** | Mirrors PlanTable's inline gear-panel expand (`expanded: Set<number>` toggle, `data-testid="gear-panel"`) — same list-row-expands pattern, no new overlay | SETTLED |
| Field scope | **All fields** (distance, gain, loss, time, 6 flags, notes) | Full parity with `aidStationCreateSchema` (schemas.ts:26); `cumulative_elevation_loss_m` already a column (gpx-import) | SETTLED |
| Endpoint | **Add `PATCH /api/aid-stations/[id]`** | `updateAidStation(id, patch)` already exists (services/aid-stations.ts:26), unwired; DELETE route at `[id].ts:9` is the auth/RLS/error template to mirror | SETTLED |
| Save | **Autosave on change** (debounced) | Matches the app-wide silent-autosave model (`useAutosave` in RaceSetupForm.tsx; PlanEditor's debounced gear-selection PUT) | SETTLED |
| GPX angle | **Uniform edit** (no special nudge) | Simplest, consistent; imported and manual stations are the same entity | SETTLED |

## Narrowing Signals

Decisive scoping answers (Step 1.5 round):

- Affordance = **inline-expand row** (not modal, not top-form reuse).
- Field scope = **all fields** → distance edits must re-sort + recompute segments (full path, not the simpler read-only-measurement subset).
- GPX angle = **uniform** → no conditional "bare import" UI branch.
- Save = **autosave on change** → no explicit Save/Cancel; edits persist debounced and the table recomputes live.

## Cross-System Convention

Every decision matches a pattern already in this repo: inline-expand (PlanTable
gear panel), autosave-on-change (RaceSetupForm / gear selections), PATCH mirroring
the existing DELETE route, and `updateAidStation` already written to the service
contract. Nothing here introduces a new architectural shape — it wires an unused
service fn to an endpoint and extends one component. The convention fit is the
main confidence driver.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: there is no in-place edit path for an
> aid station, so a runner cannot correct a mistyped value or enrich a
> GPX-imported station (which lands with facilities/time/notes empty) — they must
> delete and re-create, losing the row.

The initial framing was correct — proceed with the originally proposed direction.
The frame's value here was settling the design space (affordance, field scope,
save model, GPX handling) so the plan starts from concrete decisions rather than
open questions.

## Confidence

**HIGH** — additive feature on a well-understood surface; the service fn already
exists, all five design axes are decided, and each decision maps to an established
in-repo convention. No reproduction or further evidence-gathering needed.

## What Changes for /10x-plan

Plan an **inline-expand edit** in `AidStationManager` over **all fields**, saved
via **debounced autosave** to a new **`PATCH /api/aid-stations/[id]`** (new
`aidStationUpdateSchema`, wiring the existing `updateAidStation`). Route edited
stations through `PlanEditor.onStationsChange` so distance changes re-sort, the
plan table recomputes, and stale gear selections are pruned — same path add/delete
already use. No special-casing for GPX-imported stations.

## References

- Source: `src/components/plans/AidStationManager.tsx` (list + add + delete UI to extend)
- Source: `src/pages/api/aid-stations/[id].ts:9` (DELETE — PATCH template)
- Source: `src/lib/services/aid-stations.ts:26` (`updateAidStation`, unwired)
- Source: `src/lib/schemas.ts:26` (`aidStationCreateSchema` — basis for an update schema)
- Convention: `src/components/plans/PlanTable.tsx` (inline-expand), `src/components/plans/RaceSetupForm.tsx` + `useAutosave` (autosave model), `PlanEditor.tsx` `onStationsChange` (segment recompute + gear prune)
- PRD: US-10 / FR-007 (v5)
- Investigation tasks: none (design-shape frame; no hypothesis agents)

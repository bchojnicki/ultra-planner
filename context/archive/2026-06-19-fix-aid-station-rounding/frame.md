# Frame Brief: Unrounded aid-station distance/elevation in the UI

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Aid-station cumulative distance and elevation render **without rounding** (full
float, e.g. `10.123456 km`) in two surfaces: the **AidStationManager edit-panel
inputs** and the **read-only aid-station list shown in "view plan" mode**. The
**plan table is fine** (it renders rounded).

## Initial Framing (preserved)

- **User's stated cause or approach**: the inline-edit draft seeds inputs from `String(s.cumulative_distance_km)` with no rounding (`beginEdit`).
- **User's proposed direction**: round the seeded edit values — weighed against the calc's deliberate full-precision "accuracy guardrail".
- **Pre-dispatch narrowing**: user pinned the visible surfaces to "aid-station edit window" + "aid-station list in view-plan mode", and confirmed "plan table is OK". Layer question answered post-investigation: **consistent display everywhere** (not clean stored data).

## Dimension Map

The observation could originate at any of these dimensions:

1. **Source / storage precision (GPX import → DB)** — GPX computes raw-float cumulative values and persists them unrounded, so every consumer inherits full precision.
2. **Edit-panel input seeding** — `beginEdit` seeds the editable inputs from the raw stored float.  ← initial framing
3. **Read-only view-mode list display** — `AidStationList.astro` renders the raw stored value with no formatter.
4. **(ruled out) Plan table display** — uses `fmtKm/fmtM`; rounds correctly; user confirms it's fine.
5. **(ruled out) Editor row summary** — `AidStationManager` collapsed line rounds inline; not a reported surface.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| H1 — Source/storage carries full precision | GPX `cumulativeAt` raw floats (`src/lib/gpx.ts:74-90`); `GpxImport.tsx:52,82` POSTs station array unrounded while rounding totals at `:79-81`; zod `gpxStationSchema` plain `z.number().min(0)` (`src/lib/schemas.ts:63-68`); DB bare `numeric` no scale (`supabase/migrations/20260603132423_*.sql:53-54`, `20260617120000_*.sql:34`); `AidStation` fields plain `number` (`src/types.ts:50-66`). Stored GPX values DO carry full precision. | STRONG |
| H2 — Edit-panel input seed unrounded (initial framing) | `AidStationManager.tsx:182-184` seeds draft via `String(s.cumulative_distance_km)` — raw float → string, no rounding. | STRONG |
| H3 — View-mode list shows raw value | `AidStationList.astro:26` renders `{s.cumulative_distance_km} km · {s.cumulative_elevation_gain_m} m gain` raw (and omits loss entirely). | STRONG |
| Systemic — no shared display formatter | No formatting helper in `src/lib` (`utils.ts` only exports `cn`); rounding duplicated inline in `AidStationManager.tsx:408-411` and `PlanTable`/`plan-table.ts` (`fmtKm/fmtM`), absent in `AidStationList.astro`. | STRONG |

## Narrowing Signals

- The **plan table is correct** while two other surfaces are wrong → this is not a data-integrity problem; the data is the same, the *display* differs. Display rounding is the established, working convention.
- **Rounding is duplicated inline with no shared helper** → the two broken surfaces simply never got the rounding the others hand-rolled. Root is a missing single source of truth for display formatting, not the GPX float itself.
- User answered the layer fork: **consistent display everywhere**, storage keeps full precision → rules out source-side rounding + migration (H1's fix), rules the problem into the display layer.

## Cross-System Convention

The project's documented convention (the "accuracy guardrail" comments in
`PlanTable` / `src/lib/plan-table.ts`) is: **keep full precision in storage and
the calc; round only at display.** `fmtKm` (→ 0.1 km) and `fmtM` (→ whole
metres) are the established display rounding. The reframe aligns with this;
source-side rounding would violate it (it would feed rounded values into the
segment calc and require a migration to fix existing rows).

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: display rounding for aid-station
> distance/elevation is hand-rolled per-component with no shared formatter, so
> the read-only `AidStationList.astro` and the editable edit-panel inputs render
> the raw stored float while `PlanTable` and the editor summary round. The fix
> is a single shared display formatter applied at every aid-station surface —
> **not** rounding the stored data.

The initial framing (round the edit seed) was correct about one surface but too
narrow: it missed the second surface (view-mode list) and the systemic cause (no
shared formatter), and it flirted with the wrong layer (the "accuracy guardrail"
means we must NOT quantize storage). Reframing to a display-formatting
consistency fix cleans all current and future data without a migration and keeps
the calc's precision intact.

## Confidence

**HIGH** — strong evidence on every hypothesis, matches the documented
accuracy-guardrail convention, and the layer fork is settled (display-only). The
one open *solution* detail (below) is for /10x-plan, not a framing risk.

## What Changes for /10x-plan

Plan a **display-layer** change: introduce a shared distance/elevation formatter
(e.g. `fmtKm`/`fmtM` lifted into `src/lib`, replacing the duplicated inline
rounding in `AidStationManager` and `PlanTable`) and apply it to the two
unrounded surfaces — `AidStationList.astro` and the `AidStationManager`
edit-panel input seed. Storage, GPX import, zod, and DB are explicitly **out of
scope** (no migration).

One subtlety for the plan to resolve (not a framing question): the edit-panel
input is **editable**, not pure display. Seeding it with a rounded value means a
no-op "open then close" edit currently PATCHes `buildPatch(draft)` and would
write the rounded value back — quantizing storage as a side effect, which
contradicts "storage keeps full precision". The plan must decide how to seed the
editable input (e.g. round the seed but suppress a no-op/unchanged PATCH, or
round only the pure-display surfaces and handle the input separately).

## References

- Source files: `src/components/plans/AidStationManager.tsx:182-184,408-411`; `src/components/plans/AidStationList.astro:26`; `src/components/plans/PlanTable.tsx` + `src/lib/plan-table.ts` (`fmtKm/fmtM`); `src/lib/gpx.ts:74-90`; `src/components/plans/GpxImport.tsx:52,79-82`; `src/lib/schemas.ts:63-68`; `src/types.ts:50-66`; `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql:53-54`
- Investigation tasks: #5 (H1 source/storage), #6 (H2/H3 view-mode display)

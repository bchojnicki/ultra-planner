# Gear Profile → Unit-Level Output (Hybrid) — Plan Brief

> Full plan: `context/changes/gear-profile-units/plan.md`

## What & Why

The plan table currently shows physiological targets in grams/ml per segment. Runners actually carry discrete things — gels, a drink, bars, salt caps. This slice adds a per-plan **gear catalog** and turns the per-segment carb/fluid/sodium targets into **whole-unit fueling suggestions** ("1 drink + 9 gels + 2 bars"), which the runner can shape (per-stage unit limits) or directly override. It's a **hybrid** of auto-suggestion and per-segment control — a deliberate expansion of the PRD's one-way transform.

## Starting Point

S-01 (race setup + aid stations) and S-02 (segment-by-segment plan table) are done. `computePlanTable` is a pure function producing exact-float per-segment carb/fluid/sodium targets, rendered by `PlanTable` inside a linear `PlanEditor`. The data layer, services, API, autosave hook, and RLS plan-subquery pattern are all established and reusable. No gear concept exists yet.

## Desired End State

A runner defines gear in a new optional **Gear** section between race setup and aid stations. The plan table then shows units as the primary value with the gram/ml target and a signed ±delta beneath. Each segment row expands to set a per-product unit limit or an exact override; selections persist sparsely and survive reload. Adding/deleting an aid station clears overrides for segments that no longer map and re-suggests. With no gear, the table is unchanged. The underlying calc math is never touched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | Hybrid auto-suggest + per-segment override | Runner needs both a smart default and real per-leg control | change.md |
| Data model | Two tables: catalog + sparse selections | Normalized; mirrors plan/aid_stations parent-child RLS | Plan |
| Catalog scope | Per-plan | Self-contained, MVP-sized; reuse library is v2 | Plan |
| Selection key | Per derived segment index | Aligns 1:1 with the rendered `PlanTableRow[]` | Plan |
| Sodium | In scope (3rd target) | Salt caps fill the sodium gap for complete unit mapping | Plan |
| Item kinds | 5 (gel, drink, solid food, water carrier, salt cap) | Each exposes only its relevant nutrition fields | Plan |
| Allocation | Carb-ratio proportional split + per-stage limit redistribution | Matches the runner's worked example exactly | Plan |
| Coupling | Carbs drive unit counts; fluid/sodium fill the gap | Resolves the drink's dual carb+fluid contribution | Plan |
| Override model | Limits shape, direct override wins | Declarative for the common case, escape hatch for the specific | Plan |
| Rounding | Round-to-nearest, show ±delta | Closest units while keeping the gram/ml truth visible | Plan |
| Persistence | Autosave sparse rows (deviations only) | Reuses S-01 autosave; clean suggestion/override distinction | Plan |
| Reconciliation | Clear affected overrides on station change | No silent mis-attribution to the wrong leg | Plan |
| Display | Units primary, target + ±delta secondary | Units are the payoff; delta preserves the accuracy guardrail | Plan |
| Controls UI | Expandable per-row gear panel | Holds suggestion/limit/override without widening the table | Plan |
| Docs | Update PRD + roadmap as a phase | change.md mandates reconciling the divergence | change.md |

## Scope

**In scope:** per-plan gear catalog (5 kinds), carb-ratio auto-suggestion, per-stage limits with redistribution, direct per-stage overrides, units+delta display, sparse autosaved persistence, station-change reconciliation, sodium as a third target, PRD/roadmap reconciliation.

**Out of scope:** altering `computePlanTable` math, per-user reusable gear library, persisting auto-suggestions, fractional units, independent per-target ratios, blocking aid-station edits.

## Architecture / Approach

Bottom-up. Two additive migrations (`gear_items`, `gear_segment_selections`) with the plan-subquery RLS pattern → services + API routes mirroring plans/aid-stations → a **pure** `computeGearAllocation` transform (the calc-critical core, unit-tested in isolation, separate from `computePlanTable`) → a `GearProfileForm` slotted into `PlanEditor` → `PlanTable` units display + expandable limit/override panel wired through `useAutosave` → docs. Allocation order per segment: carbs (ratio split → limit-cap redistribution cascade → round) drive gel/drink/food units; drink fluid + water carrier fill the fluid target; gel/drink/food sodium + salt caps fill the sodium target; deltas computed against targets.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model & RLS | Two tables, types, zod, integration tests | RLS plan-subquery correctness |
| 2. Services & API | Gear-item + selection CRUD/upsert endpoints | Endpoint/error-mapping consistency |
| 3. Allocation transform | Pure `computeGearAllocation` + unit tests | Redistribution cascade + coupling math |
| 4. Gear catalog UI | `GearProfileForm` in the editor, autosaved | Per-kind field visibility |
| 5. Table integration + e2e | Units/±delta display, limit/override panel, reconciliation | State sync + override persistence |
| 6. Docs reconciliation | PRD FR-004/US-06 + roadmap S-03 updated | Accuracy vs shipped behavior |

**Prerequisites:** S-02 done (it is). Local Supabase running for migration/integration tests.
**Estimated effort:** ~5–6 focused sessions across 6 phases; Phase 3 (allocation) and Phase 5 (table integration) carry the most weight.

## Open Risks & Assumptions

- Segment-index reconciliation uses a positional rule; a runner who hand-tunes a leg then inserts a station before it loses that tuning (accepted tradeoff).
- Carb-led allocation assumes carbs are the primary driver — true for ultra fueling, but fluid-led runners get less direct control over drink units (mitigated by direct overrides).
- Round-to-nearest can slightly over-suggest; the visible ±delta keeps this honest.

## Success Criteria (Summary)

- Defining gear turns the table into correct whole-unit output with an accurate ±delta vs the gram/ml target.
- Per-stage limits redistribute correctly; direct overrides win and persist across reload; station changes clear stale overrides.
- `computePlanTable` and its tests are unchanged — gram/ml math proven intact.

# Generate Plan Table (S-02) — Plan Brief

> Full plan: `context/changes/generate-plan-table/plan.md`

## What & Why

Compute and live-render the segment-by-segment plan table — the product wedge: nutrition derived **per time-on-feet per segment** (distance + elevation weighted), not as a flat total. This is roadmap slice S-02, the **north star** that validates the core hypothesis. It turns the inputs S-01 persists into the correct per-leg travel time, clock arrival, and fluid/carb/sodium targets.

## Starting Point

F-01 + S-01 already persist everything the calc needs (`plans` params + distance-sorted `aid_stations`) and render an editor at `/plans/[id]` using two independent React islands (`RaceSetupForm` autosaves params; `AidStationManager` manages stations). No table, no calc yet. The algorithm is fully specified in the PRD Business Logic.

## Desired End State

On `/plans/[id]`, as the runner edits, a table updates live (no generate button) with one row per segment across the whole race — start → each station → finish — showing distance, elevation gain, moving time, clock arrival, fluid/carb/sodium, end-station facilities/rest/notes, and a totals row. Zero stations → one start→finish row. Missing distance/elevation/expected time → a clear error prompt.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the calc lives | Pure `computePlanTable()` in `src/lib/`, compute-on-read | Isolates and unit-tests the wedge; S-04 owns persistence | Plan |
| Reactivity | Merge editor into one `PlanEditor` island | Shared live state so the table tracks edits cleanly | Plan |
| Trigger | Live auto-compute (no Generate button) | Satisfies US-04 "updates without re-trigger"; calc is cheap | Plan |
| Zero aid stations | Valid → single start→finish row | A race can have no aid stations | User |
| Required params | distance, elevation gain, expected time > 0, else error | A plan is meaningless without them; also guards ÷0 | User |
| Rest-time model | total = moving + rest; rest shrinks the moving budget | Rest forces faster moving; expected finish unchanged | User |
| Segments | Full race: start → each station → finish | Totals cover the whole distance | Plan |
| Rounding | Float internally, round only at display | Honors the PRD calc-accuracy guardrail | Plan |
| Columns | Full leg row + facility badges + totals row | Covers FR-007 + race-level summary | Plan |
| Testing | Vitest golden-number unit tests + light e2e | Rigorously validates the wedge and that it renders | Plan |

## Scope

**In scope:** pure calc function + golden-number tests; merge editor into one reactive island; `PlanTable` with table/error/zero-station states, totals, facility badges; e2e number assertion.

**Out of scope:** persisting the table (S-04), gear/unit-level output (S-03), schema/endpoints/migration, elevation-loss or advanced pacing models, editing-model changes.

## Architecture / Approach

`computePlanTable(plan, stations)` (pure, `src/lib/plan-table.ts`) returns a discriminated `PlanTableResult` (`ok` table+totals, or an error variant). `PlanEditor` (new island) owns live `plan` + `stations` state — `RaceSetupForm`/`AidStationManager` become children that emit changes upward (autosave + add/delete preserved) — and `useMemo`s the result into `PlanTable`. Time model: `moving = expected − Σrest`, distributed by Naismith weight (`dist + 0.01·gain`); arrivals accumulate moving + prior rest so finish == `start + expected`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Calc + unit tests | Pure `computePlanTable` + golden-number Vitest suite | Correctness of the formula / golden numbers (the wedge) |
| 2. PlanEditor merge | Two islands lifted under one reactive root, S-01 behavior intact | Regressing autosave / add-delete during the refactor |
| 3. PlanTable + e2e | Live table, error/zero-station states, totals, facilities | Cross-checking rendered numbers; mobile layout |

**Prerequisites:** F-01 + S-01 (done/archived); local Supabase + `TEST_EMAIL`/`TEST_PASSWORD` for the e2e.
**Estimated effort:** ~3 sessions, one per phase (Phase 1 is the substance).

## Open Risks & Assumptions

- Nutrition is based on **moving** time-on-feet per segment (not rest); arrival math keeps finish == start + expected.
- Elevation **gain** > 0 is required (a truly flat ultra would need a tiny value); `total_elevation_loss_m` is unused by the calc.
- Stations at/after the finish, or with duplicate cumulative distance, are dropped/skipped (no zero-length rows).

## Success Criteria (Summary)

- A runner sees a correct per-segment table (hand-verifiable against the worked reference) that updates live.
- Zero-station and missing-param cases behave per the decisions above.
- Vitest golden-number tests + Playwright number assertion pass; tsc/lint/build clean.

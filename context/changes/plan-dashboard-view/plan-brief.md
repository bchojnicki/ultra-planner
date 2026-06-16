# Plan Dashboard — Read-Only Saved-Plan View — Plan Brief

> Full plan: `context/changes/plan-dashboard-view/plan.md`

## What & Why

Deliver the read-only "view a saved plan" experience (roadmap S-04 → US-07 / FR-009). A runner who returns to the dashboard and selects a plan should see it — race parameters, aid stations, gear profile, and the generated plan table — in read-only form, without the editing affordances of the creation flow. Full editing of saved plans is parked to v2.

## Starting Point

The dashboard already lists plans (name + updated date, empty state) and the plan table is computed on read, not stored. But selecting a plan currently opens the fully editable `PlanEditor`. The only gap is a read-only presentation that coexists with the editable create/edit flow.

## Desired End State

`/plans/[id]` is a read-only page (the dashboard target); the existing editor lives at `/plans/[id]/edit` (the create/edit target). The read-only page shows all saved data plus the generated table (whole-unit Fuel when gear is defined, gram/ml/mg otherwise), with a single "Edit plan" link bridging back to the editor. Incomplete drafts show the calc's existing explanatory message instead of a broken table.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Edit/view coexistence | Split routes: `/plans/[id]` read-only, `/plans/[id]/edit` editor | Cleanest mapping to "selecting a plan → read-only" while reusing the existing editor island verbatim | Plan |
| Re-edit access | Single "Edit plan" link to the editor | Autosave has no "done" signal, so trapping runners read-only would strand partial plans; the editor already exists | Plan |
| Read-only rendering | Dedicated `.astro` presentational components | Truly non-editable (no inputs to disable), server-rendered, no client island needed | Plan |
| Gear in read-only table | Show Fuel column, hide expand/limit/override panels | Preserves the configured unit-level output without any editing controls | Plan |
| Incomplete plan | Show saved values + the calc's existing explanatory message | Reuses `computePlanTable`'s not-ok states with zero new logic (US-01 "explanatory state") | Plan |
| Testing | One Playwright e2e for the read-only path | Matches existing spec pattern and guards the exact US-07 behavior; calc already unit-tested | Plan |

## Scope

**In scope:** Route split + editor relocation; repointed create redirect; read-only summary/aid-station/gear components; a `readOnly` plan table; server-side table + allocation computation (shared helper); one e2e spec.

**Out of scope:** Delete from dashboard (S-05); rename (v2); any new edit UX beyond the link; dashboard redesign; schema/API/calc changes.

## Architecture / Approach

Two sibling routes replace one. `/plans/[id].astro` loads the plan and renders three `.astro` read-only sections plus `<PlanTable readOnly />` with **no** `client:*` directive — pure SSR, zero JS. `/plans/[id]/edit.astro` holds today's `PlanEditor` island. `POST /api/plans` redirects to `/edit`. The table result and gear allocations are computed in the read-only page's frontmatter via the existing pure functions (`computePlanTable`, `computeGearAllocation`), with the per-segment allocation mapping extracted from `PlanEditor` into a shared `computeAllocations` helper.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Routing split + editor relocation | Editor at `/edit`, read-only shell at `/plans/[id]`, create redirects to `/edit` | Astro route coexistence (`[id].astro` + `[id]/`); not breaking the existing e2e URL match |
| 2. Read-only view | Presentational components + `readOnly` static table, incomplete-plan handling | Keeping the table truly non-interactive; avoiding editor/view drift (mitigated by shared helper) |
| 3. e2e test + verification | Playwright spec asserting read-only + Edit link | Requires an authed local Supabase session (same as existing specs) |

**Prerequisites:** S-02 (generate-plan-table) — done. Local Supabase + a confirmed test user for the e2e.
**Estimated effort:** ~1–2 sessions across 3 phases (mostly presentational; no data/calc work).

## Open Risks & Assumptions

- Assumes Astro serves `src/pages/plans/[id].astro` and `src/pages/plans/[id]/edit.astro` side by side (standard Astro routing) — verified by the Phase 1 build.
- Assumes a React component rendered without a `client:*` directive yields static HTML — relied on for the zero-JS read-only table.
- The "Edit plan" link means saved-plan editing is technically reachable in MVP; this is intentional (it reuses the creation editor, not a new v2 surface).

## Success Criteria (Summary)

- Selecting a plan from the dashboard opens it read-only — all data shown, nothing editable, table rendered.
- "+ New plan" and "Edit plan" both reach the editable editor; edits still autosave.
- An incomplete plan shows an explanatory state, not a broken/empty table.

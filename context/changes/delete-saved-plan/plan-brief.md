# Delete Saved Plan — Plan Brief

> Full plan: `context/changes/delete-saved-plan/plan.md`

## What & Why

Let a runner permanently delete a saved plan from the dashboard, behind an explicit confirmation dialog, with no undo (roadmap S-05 → US-09 / FR-011). It closes the plan lifecycle: create → view → delete.

## Starting Point

The backend is almost entirely ready — `deletePlan` exists, the `plans_delete_own` RLS policy is live, and all child tables (`aid_stations`, `gear_items`, `gear_segment_selections`) cascade on `plan_id` delete. The only gaps: `/api/plans/[id]` has no `DELETE` handler, and the dashboard is a static Astro page with no interactivity for a dialog.

## Desired End State

Each dashboard plan row has a delete control. Activating it opens a modal naming the plan ("Delete '<name>'? This can't be undone") with Cancel/Delete. Confirming removes the plan (children cascade) and the row disappears immediately with no reload — revealing the empty-state if it was the last plan. Cancel/Escape/backdrop dismiss without deleting; a failed delete keeps the row and shows an inline error.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Confirm dialog | Hand-rolled cosmic modal | Matches the app's hand-rolled UI, zero new deps, can name the plan; no shadcn dialog is installed |
| Dashboard refresh | `PlanList` island, fetch DELETE + local removal | True immediate update with no reload; mirrors the PlanEditor/GearProfileForm fetch+state pattern |
| Delete location | Dashboard only | Exactly US-09's acceptance criterion; keeps scope tight |
| Error/in-flight UX | Disable during request; keep row + inline error on failure | Row only disappears on confirmed success; mirrors GearProfileForm's delete pattern |
| Endpoint semantics | Mirror aid-stations: idempotent 204, no malformed-id guard | Consistency with sibling DELETE endpoints; UI only sends real owned ids |
| Testing | e2e delete path + positive owner-delete integration case | Covers the US-09 UI contract and the delete RLS boundary (negative case already exists) |

## Scope

**In scope:** `DELETE /api/plans/[id]`; a `PlanList` island with per-row delete + confirm modal + immediate update; e2e + integration coverage.

**Out of scope:** undo/soft-delete; delete from the read-only view; bulk delete; rename; any schema/RLS/migration change; a shadcn dialog dependency.

## Architecture / Approach

Add the `DELETE` handler mirroring `aid-stations/[id].ts` (auth → `deletePlan` → 204; RLS-scoped; children cascade). Convert the dashboard list into a `PlanList` React island seeded with the server-loaded plans, owning the list, empty-state, per-row delete control, and a hand-rolled confirm modal; delete via `fetch` then remove from local state. `dashboard.astro` keeps its header and "New plan" form and renders `<PlanList client:load plans={plans} />`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DELETE endpoint | `DELETE /api/plans/[id]` (idempotent 204, cascade) | Trivial — mirrors an existing endpoint |
| 2. Dashboard delete UI | `PlanList` island + confirm modal + live removal | First confirm-dialog in the app; a11y basics (focus/Escape/backdrop) hand-rolled |
| 3. Tests | e2e delete path + owner-delete integration case | e2e needs an authed local Supabase session (seeded user exists) |

**Prerequisites:** S-04 (dashboard + view) — done. Local Supabase + seeded test user for the e2e/integration runs.
**Estimated effort:** ~1 session across 3 phases (small backend delta; the island is the bulk).

## Open Risks & Assumptions

- Hand-rolled modal must cover focus management, Escape, and backdrop dismiss to be a proper confirmation dialog (no library safety net).
- Converting the static list to an island changes the row markup (delete control can't nest inside the row `<a>`); the link affordance must be preserved.
- Assumes child-table cascades hold (verified in the three migrations) so one `deletePlan` fully cleans up.

## Success Criteria (Summary)

- Deleting a plan from the dashboard removes it immediately, behind a confirm dialog, with no reload.
- A cancelled/dismissed dialog never deletes; a failed delete is recoverable and surfaced.
- Deleted plans (and their stations/gear) are gone server-side on reload.

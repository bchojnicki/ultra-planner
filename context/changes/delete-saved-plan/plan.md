# Delete Saved Plan Implementation Plan

## Overview

Let a runner permanently delete a saved plan from the dashboard (roadmap S-05 → US-09 / FR-011). Each dashboard plan row gets a delete control that opens an explicit confirmation modal; on confirm, the app calls `DELETE /api/plans/[id]`, the plan and all its child rows are removed, and the dashboard list updates immediately with no reload. Deletion is permanent — no undo (undo is v2).

The backend is already in place except for the endpoint: `deletePlan` exists, the `plans_delete_own` RLS policy is live, and every child table (`aid_stations`, `gear_items`, `gear_segment_selections`) declares `plan_id ... on delete cascade`. The dashboard is currently a static Astro page, so it becomes a React island to host the confirmation dialog and live list update.

## Current State Analysis

- **`deletePlan` exists** (`src/lib/services/plans.ts:54`) — request-scoped client, throws on Supabase error, RLS scopes to owner.
- **`DELETE /api/plans/[id]` does NOT exist** — `src/pages/api/plans/[id].ts` exports only `PATCH`. The template to mirror is `src/pages/api/aid-stations/[id].ts` (auth → service delete → `204`; RLS makes a non-owned delete an idempotent no-op).
- **Cascade is complete** — `plans_delete_own` RLS policy exists (migration `20260603132423`), and `aid_stations`, `gear_items`, `gear_segment_selections` all FK `plan_id ... on delete cascade`. Deleting a plan removes its stations, gear catalog, and per-segment selections automatically. No new migration needed.
- **Dashboard is static** (`src/pages/dashboard.astro`) — server-loads `plans` via `listPlans`, renders an empty-state and a `<ul>` of `<a href="/plans/${id}">` rows, plus form-POSTs for sign-out and "New plan". No React island, no per-row actions.
- **No confirmation-dialog pattern exists** in the codebase; only `button.tsx` is installed from shadcn/ui. The app hand-rolls its "cosmic" UI (e.g. `PlanTable.tsx`, the auth/plan forms).
- **Fetch + local-state mutation is the established island pattern** (`GearProfileForm.tsx` delete: fetch → on success remove from local list → on failure keep item + show inline error). The delete UI mirrors this.
- **RLS ownership is already tested** (`tests/integration/rls-ownership.test.ts`) including the *negative* delete case ("runner B's DELETE of runner A's plan affects no rows", line 190). The missing coverage is the *positive* owner-deletes-own case.

## Desired End State

On the dashboard, each plan row shows a delete control. Activating it opens a modal naming the plan and warning the deletion can't be undone, with Cancel and Delete actions. Cancelling (button, Escape, or backdrop) dismisses with no change. Confirming disables the control, calls `DELETE /api/plans/[id]`, and on success removes the row from the list immediately (showing the empty-state prompt if it was the last plan); on failure the row stays and an inline error appears. Dismissing the dialog without confirming never deletes. Reloading confirms the plan is gone server-side.

Verify by: deleting a plan from the dashboard removes it without a page reload; the confirm dialog gates the deletion; a cancelled dialog leaves the plan; the deleted plan (and its stations/gear) no longer exist on reload.

### Key Discoveries:

- `DELETE /api/aid-stations/[id].ts` is the exact endpoint template (`src/pages/api/aid-stations/[id].ts:9-21`) — auth guard, request-scoped client, service call, `204`, idempotent for non-owned ids.
- All child FKs cascade (`supabase/migrations/20260603132423_*.sql:52`, `20260616073640_*.sql:24`, `20260616073641_*.sql:23-24`) — a single `deletePlan` removes everything.
- `GearProfileForm.tsx:255-263` is the delete-UX reference: fetch → success removes from local state, failure sets an inline error string; the row is never removed optimistically.
- `dashboard.astro:8` already loads `plans` server-side, so the island can be seeded via props (no client fetch on mount).

## What We're NOT Doing

- **No undo / soft-delete / trash** — FR-011 is permanent hard delete; undo is v2.
- **No delete from the read-only plan view** (`/plans/[id]`) — US-09's AC scopes the delete action to the dashboard.
- **No bulk/multi-select delete** — one plan at a time.
- **No new migration, RLS change, or schema change** — the delete policy and cascades already exist.
- **No shadcn dialog/alert-dialog dependency** — the confirm modal is hand-rolled in the cosmic style.
- **No rename or other dashboard actions** — rename is v2 (FR-010).

## Implementation Approach

Add the missing `DELETE` endpoint (mirroring the aid-stations one) so the data path is testable on its own. Then convert the dashboard's static list into a `PlanList` React island seeded with the server-loaded plans; the island owns the list, the empty-state, the per-row delete control, and a hand-rolled confirmation modal, using the codebase's fetch-then-local-state delete pattern. Cover the user-visible contract with a Playwright e2e and the security boundary with a positive owner-delete integration case.

## Phase 1: DELETE endpoint

### Overview

Expose plan deletion over HTTP, owner-scoped and idempotent, reusing the existing service and RLS.

### Changes Required:

#### 1. DELETE handler

**File**: `src/pages/api/plans/[id].ts`

**Intent**: Add a `DELETE` export alongside the existing `PATCH` so the dashboard can delete a plan. Mirror the aid-stations endpoint: authenticate, build the request-scoped client, call `deletePlan`, return `204`. RLS hides non-owned rows, so deleting a non-owned/already-gone id is an idempotent no-op (still `204`); child rows cascade via existing FKs.

**Contract**: New `export const DELETE: APIRoute`. Returns `401` when unauthenticated, `400` on missing id, `204` on success. Uses `deletePlan(supabase, id)` from `@/lib/services/plans`. Matches `src/pages/api/aid-stations/[id].ts:9-21`. (Consistent with the sibling endpoints, a malformed-uuid id is not specially guarded; the dashboard never produces one.)

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`
- Integration suite still green: `npx vitest run tests/integration`

#### Manual Verification:

- `DELETE /api/plans/<own-plan-id>` returns 204 and the plan is gone on the dashboard after reload
- The plan's aid stations and gear rows are also gone (cascade) — confirmed via a re-open or DB check

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Dashboard delete UI (PlanList island)

### Overview

Make the dashboard interactive: a `PlanList` island renders the plan list and empty-state, with a per-row delete control gated by a confirmation modal and an immediate local list update.

### Changes Required:

#### 1. PlanList island

**File**: `src/components/plans/PlanList.tsx` (new)

**Intent**: A React island that owns the dashboard's plan list and empty-state. Seeded with the server-loaded plans via props; renders each plan as a link (name + last-updated date, preserving the current row appearance) plus a delete control. Clicking delete opens a confirmation modal naming the plan; confirming disables the control and calls `DELETE /api/plans/${id}`, then removes the plan from local state on success (the empty-state renders when the list becomes empty). On a non-2xx/network error the plan stays and an inline error message shows. In-flight, the confirm/delete control is disabled to prevent double-submit. Mirrors the fetch-then-local-state delete pattern in `GearProfileForm.tsx`.

**Contract**: `export default function PlanList({ plans }: { plans: Plan[] })`. Renders the same row affordance as today (link to `/plans/${id}`, name, `Updated <date>`) — note the delete control must sit outside the `<a>` (no nested interactive elements). Date formatting matches the current `fmtDate` in `dashboard.astro`. Uses `fetch(\`/api/plans/${id}\`, { method: "DELETE" })`; treats any `res.ok` (204) as success. Holds `plans`, a `pendingId | null`, a `confirmingId | null`, and an `error` string in state.

#### 2. Confirmation modal

**File**: `src/components/plans/PlanList.tsx` (same file, or a small co-located component)

**Intent**: A hand-rolled cosmic-styled modal overlay shown while `confirmingId` is set: a backdrop, a panel naming the plan ("Delete '<name>'? This can't be undone."), and Cancel / Delete actions. Cancel, Escape, and backdrop click dismiss without deleting; Delete triggers the fetch.

**Contract**: Modal is conditionally rendered from `PlanList` state (no portal/library). Provides a11y basics: focus moves to the dialog, Escape closes it, the backdrop is click-to-dismiss, and the confirming control carries an accessible label. The destructive action is visually distinct (e.g. red). No `window.confirm`.

#### 3. Dashboard wires in the island

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the static `<ul>`/empty-state block with `<PlanList client:load plans={plans} />`. Keep the header, sign-out form, and the "New plan" form-POST as they are.

**Contract**: Import `PlanList`; pass the already-loaded `plans`. The empty-state currently in the `.astro` moves into the island (so it updates after the last deletion). No change to data loading (`listPlans`) or the page's auth gating.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`
- Unit/integration suites still green: `npx vitest run tests/unit tests/integration`

#### Manual Verification:

- Each plan row shows a delete control; clicking it opens a modal naming the plan
- Confirming deletes the plan and removes the row immediately (no reload); deleting the last plan reveals the empty-state prompt
- Cancel, Escape, and backdrop click all dismiss the modal without deleting
- A failed delete (e.g. offline) keeps the row and shows an inline error; the control is disabled while a delete is in flight
- The "New plan" button and sign-out still work

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Tests

### Overview

Guard the user-visible delete contract and the delete-ownership security boundary.

### Changes Required:

#### 1. Delete e2e spec

**File**: `tests/plan-delete.spec.ts` (new)

**Intent**: Cover the US-09 path end-to-end. Gated behind `TEST_EMAIL`/`TEST_PASSWORD`, mirroring `tests/plans-setup.spec.ts` (uses `waitHydrated`, runs against local Supabase). Create a plan, return to the dashboard, open the delete modal, assert Cancel leaves the plan, then confirm and assert the row disappears.

**Contract**: Steps: sign in → "New plan" → set a recognizable name, return to `/dashboard` and `waitHydrated` → assert the plan row is present → click its delete control → modal appears → Cancel → row still present → delete again → confirm → row is removed (assert the `a[href="/plans/<id>"]` count drops to 0). Reuse the seeded local user pattern from the other specs.

#### 2. Owner-delete integration case

**File**: `tests/integration/rls-ownership.test.ts`

**Intent**: Add a positive case — runner A deletes their own plan and the row is gone — complementing the existing negative case (B can't delete A's plan). Place it as the final `it` so it doesn't disturb the shared `planAId` used by earlier assertions.

**Contract**: New `it("(e) runner A can delete its own plan", …)`: `clientA.from("plans").delete().eq("id", planAId).select()` returns the deleted row (length 1, no error); a follow-up select by A returns `[]`. (Cascade to children is already guaranteed by FK + covered structurally; the focus here is the owner-delete RLS path.)

### Success Criteria:

#### Automated Verification:

- New e2e passes: `npx playwright test tests/plan-delete.spec.ts` (with `TEST_EMAIL`/`TEST_PASSWORD` against local Supabase)
- Full e2e suite green: `npx playwright test`
- Integration suite green incl. new case: `npx vitest run tests/integration`
- Linting passes: `npm run lint`

#### Manual Verification:

- The e2e is skipped (not failed) when `TEST_EMAIL`/`TEST_PASSWORD` are unset, matching the other gated specs

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- None required — no new pure logic; deletion is a thin endpoint + UI over existing service/RLS.

### Integration Tests:

- Add the positive owner-delete case to `tests/integration/rls-ownership.test.ts`; the negative (non-owner) delete case already exists.

### Manual Testing Steps:

1. Create two plans; delete one from the dashboard → it disappears immediately, the other remains.
2. Delete the remaining plan → the empty-state prompt appears.
3. Open the delete modal and Cancel / press Escape / click the backdrop → nothing is deleted.
4. Re-open the app (reload) → deleted plans do not reappear.
5. Open a deleted plan's old URL `/plans/<id>` → redirects to `/dashboard` (plan no longer exists).

## Performance Considerations

Negligible — a single `DELETE` of one indexed row plus cascade deletes of a handful of child rows, at the PRD's low-qps / small-data scale.

## Migration Notes

No migration. The delete RLS policy and all child-table cascades already exist from F-01 and S-03.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-05)
- PRD: `context/foundation/prd.md` (US-09, FR-011)
- Endpoint template: `src/pages/api/aid-stations/[id].ts`
- Delete-UX pattern: `src/components/plans/GearProfileForm.tsx:255-263`
- Service: `src/lib/services/plans.ts` (`deletePlan`)
- Existing RLS test: `tests/integration/rls-ownership.test.ts`
- Prior slice (dashboard + view): `context/archive/2026-06-16-plan-dashboard-view/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DELETE endpoint

#### Automated

- [x] 1.1 Type checking / build passes: `npx astro sync && npm run build` — 782da89
- [x] 1.2 Linting passes: `npm run lint` — 782da89
- [x] 1.3 Integration suite still green: `npx vitest run tests/integration` — 782da89

#### Manual

- [x] 1.4 `DELETE /api/plans/<own-plan-id>` returns 204 and the plan is gone after reload — 782da89
- [x] 1.5 The plan's aid stations and gear rows are also gone (cascade) — 782da89

### Phase 2: Dashboard delete UI (PlanList island)

#### Automated

- [x] 2.1 Type checking / build passes: `npx astro sync && npm run build` — 2fe7a24
- [x] 2.2 Linting passes: `npm run lint` — 2fe7a24
- [x] 2.3 Unit/integration suites still green: `npx vitest run tests/unit tests/integration` — 2fe7a24

#### Manual

- [x] 2.4 Each row has a delete control; clicking opens a modal naming the plan — 2fe7a24
- [x] 2.5 Confirming removes the row immediately (no reload); deleting the last plan reveals the empty-state — 2fe7a24
- [x] 2.6 Cancel, Escape, and backdrop click dismiss without deleting — 2fe7a24
- [x] 2.7 A failed delete keeps the row + shows an inline error; control disabled while in flight — 2fe7a24
- [x] 2.8 "New plan" and sign-out still work — 2fe7a24

### Phase 3: Tests

#### Automated

- [x] 3.1 New e2e passes: `npx playwright test tests/plan-delete.spec.ts`
- [x] 3.2 Full e2e suite green: `npx playwright test`
- [x] 3.3 Integration suite green incl. new case: `npx vitest run tests/integration`
- [x] 3.4 Linting passes: `npm run lint`

#### Manual

- [x] 3.5 The e2e is skipped (not failed) when `TEST_EMAIL`/`TEST_PASSWORD` are unset

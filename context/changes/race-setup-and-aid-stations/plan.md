# Race Setup + Aid Stations (S-01) Implementation Plan

## Overview

Build the race-setup vertical slice on top of the F-01 data layer: a logged-in runner creates a draft plan, edits race parameters with silent debounced autosave, and adds / lists / deletes aid stations — reachable from a minimal dashboard list. This is the "build a plan" experience (FR-003, FR-005, FR-006, FR-008; US-04, US-05, US-08). It deliberately stops short of generating the segment table (S-02), the gear profile (S-03), and the polished read-only dashboard view (S-04).

## Current State Analysis

- **Data layer is done (F-01, archived).** `plans` + `aid_stations` tables with owner-scoped RLS, plus `src/lib/services/plans.ts` (`listPlans`, `getPlan`, `createPlan`, `updatePlan`, `deletePlan`) and `src/lib/services/aid-stations.ts` (`listAidStations`, `createAidStation`, `updateAidStation`, `deleteAidStation`). All take the request-scoped SSR client; RLS enforces ownership. Entity + DTO types live in `src/types.ts`.
- **Hard constraint: every `plans` parameter column is `NOT NULL`** (F-01 migration). A partial draft cannot be persisted as NULLs without a new migration — so drafts are created with seeded defaults (decided below). `aid_stations.cumulative_distance_km` / `cumulative_elevation_gain_m` are also `NOT NULL`; `time_spent_min` defaults `0`, the six facility flags default `false`, `notes` is nullable.
- **Established form/endpoint pattern** (`src/components/auth/SignUpForm.tsx`, `src/pages/api/auth/signup.ts`): a React island form with client-side validation → API route uses `createClient(headers, cookies)` from `src/lib/supabase.ts` → server `redirect`. Reusable `FormField` / `SubmitButton` / `ServerError` in `src/components/auth/`. This full-page-POST pattern fits "New plan" and delete actions, but **not** silent autosave, which needs client-side debounced `fetch`.
- **Auth + routing**: `src/middleware.ts` resolves `context.locals.user` on every request and gates `PROTECTED_ROUTES = ["/dashboard"]`. `src/pages/dashboard.astro` is a placeholder. `src/env.d.ts` types `App.Locals.user`.
- **Conventions** (CLAUDE.md): API routes use uppercase method exports, **validate input with zod**, and **export `const prerender = false`** (the existing auth routes predate this and do neither — new endpoints will follow the convention). React hooks go in `src/components/hooks/`. `zod` is **not yet a dependency**.
- **Tests**: Vitest integration harness exists (`vitest.config.ts` → `tests/integration/**`, local-Supabase pattern from F-01) and Playwright e2e (`tests/*.spec.ts`, `tests/auth.spec.ts` gates real-login tests behind `TEST_EMAIL` / `TEST_PASSWORD`).

## Desired End State

After this plan:

- A logged-in runner on `/dashboard` sees a minimal list of their plans (name + last-updated, linking to the editor) and a **New plan** button; with no plans they see an empty-state prompt.
- Clicking **New plan** creates a draft (seeded defaults) and lands the runner on `/plans/<id>`.
- On `/plans/<id>` the runner edits race parameters (name, total distance, elevation gain/loss, start time, expected finish time as hours+minutes, hourly fluid/carb/sodium targets). Changes autosave silently after a short debounce, with a subtle idle/saving/saved/error indicator. Reloading the page shows everything intact.
- The runner adds aid stations via an inline add-row (cumulative distance, cumulative elevation gain, time at station, six facility checkboxes, notes); each addition persists immediately and appears in cumulative-distance order regardless of entry order. Each station has a delete action (no confirmation) that removes it immediately.
- Another runner can never read or mutate these rows (RLS, already proven in F-01 and re-exercised for the new write paths).

Verify by: Vitest integration green against local Supabase, `npx tsc --noEmit` + `npm run lint` clean, `npm run build` succeeds, and the Playwright e2e (create → params → add/delete station → reload-persists) passing with test credentials.

### Key Discoveries:

- Request-scoped client + services to reuse: `src/lib/supabase.ts:6`, `src/lib/services/plans.ts`, `src/lib/services/aid-stations.ts`.
- Form pattern to mirror for non-autosave actions: `src/pages/api/auth/signup.ts:4` (POST → redirect) and `src/components/auth/SignUpForm.tsx`.
- `total_expected_minutes` is whole minutes (F-01); the hours+minutes UI converts client-side (`h*60 + m`), DB stays integer.
- `aid_stations` ownership is enforced through the parent-plan RLS subquery — a cross-user station INSERT is rejected by `WITH CHECK` (PostgREST code `42501`), proven in F-01's test.

## What We're NOT Doing

- **No segment/plan-table generation** — S-02 owns the calculation and table (US-01, FR-007). US-04's "plan table reflects the new segment" is satisfied later by S-02; S-01 stores inputs and lists stations only.
- **No gear profile** (step 2 of the four-step flow) — S-03 (FR-004).
- **No read-only saved-plan view / polished dashboard** — S-04 (US-07, FR-009). S-01 ships only the minimal list needed to navigate back to a draft (US-08).
- **No plan deletion** — S-05 (US-09, FR-011). Abandoned drafts persist for now; cleanup is a known limitation noted below.
- **No inline editing of an aid station** — correction is delete + re-add (FR-006 resolution). No edit/rename of plans (FR-010 is v2).
- **No new migration / schema change** — the NOT-NULL constraint is handled with seeded defaults, not by altering F-01.

## Implementation Approach

Three sequential, independently verifiable phases, building back-to-front so each layer is testable before the next depends on it:

1. **Backend** — zod validators + thin JSON API endpoints over the existing services, a `createDraftPlan` helper, middleware protection. Verified by Vitest against local Supabase.
2. **Server-rendered pages** — the editor page (SSR-loads plan + stations) and the dashboard list + New-plan entry. Static render, no client interactivity yet, so it's verifiable by navigation alone.
3. **Interactive islands + e2e** — the autosave param form and the aid-station manager, plus the Playwright flow test that exercises the whole slice.

## Critical Implementation Details

- **Draft defaults satisfy NOT NULL.** `createDraftPlan` inserts `name: "Untitled plan"`, all numeric params `0`, `start_time: now (ISO)`, `total_expected_minutes: 0`, with `user_id` from `context.locals.user.id`. Autosave PATCHes real values over these. This is the agreed alternative to a nullable-columns migration.
- **Autosave is silent but not invisible.** US-08 forbids a save button and "unsaved changes" warnings; the indicator is a passive idle/saving/saved/error affordance only — never a dialog, never blocking.
- **Endpoint auth.** API routes are not covered by `PROTECTED_ROUTES`; each handler must read `context.locals.user` and return `401` when absent (and treat a missing/`null` SSR client as `500`). RLS is the second line of defense, not the first.
- **No-row updates map to 404.** A `PATCH`/`DELETE` for an id the user doesn't own is hidden by RLS (0 rows). Handlers translate that into `404`, never a `500`.

## Phase 1: Backend — validated API + service/middleware wiring

### Overview

Add zod validation, a draft-plan helper, the four JSON endpoints the UI needs, and route protection. Prove the new write paths against local Supabase with Vitest.

### Changes Required:

#### 1. Add `zod` dependency

**File**: `package.json`

**Intent**: zod is the mandated input-validation library (CLAUDE.md) and is not yet installed.

**Contract**: add `zod` to `dependencies`; lockfile updated. No script changes.

#### 2. Request validation schemas

**File**: `src/lib/schemas.ts` (new)

**Intent**: Centralize zod schemas for plan-param updates and aid-station creation so every endpoint validates identically.

**Contract**: export `planUpdateSchema` — all params optional (mirrors `PlanUpdate`): `name` (non-empty string), the five `numeric` params and three hourly targets (finite, `>= 0`), `start_time` (ISO datetime string), `total_expected_minutes` (int `>= 0`). Export `aidStationCreateSchema` — `cumulative_distance_km` and `cumulative_elevation_gain_m` required (finite, `>= 0`); `time_spent_min` (`>= 0`), the six boolean flags, and `notes` (string, nullable) optional. Both reject unknown keys. Inferred types align with the F-01 DTOs in `src/types.ts`.

#### 3. Draft-plan service helper

**File**: `src/lib/services/plans.ts` (modify)

**Intent**: One place that defines the seeded-default draft so the contract is explicit and testable.

**Contract**: add `createDraftPlan(client, userId: string): Promise<Plan>` that inserts a `PlanInsert` with `user_id: userId` and the seeded defaults from Critical Implementation Details, returning the created row (throws on error, like the sibling helpers).

#### 4. Plans collection endpoint

**File**: `src/pages/api/plans/index.ts` (new)

**Intent**: Create a draft and send the runner into the editor — the "New plan" action.

**Contract**: `export const prerender = false`. `POST` — require `context.locals.user` (else `401`); `createClient` (null → `500`); `createDraftPlan(client, user.id)`; `redirect` to `/plans/<id>`. (Classic form-POST, mirroring `signout`.)

#### 5. Plan item endpoint

**File**: `src/pages/api/plans/[id].ts` (new)

**Intent**: Autosave param updates for one plan.

**Contract**: `export const prerender = false`. `PATCH` — require auth; parse JSON body through `planUpdateSchema` (`400` on failure); `updatePlan(client, id, patch)`; map a no-row/not-owned result to `404`; on success return `200` JSON `{ updated_at }`. No `user_id` handling — RLS scopes it.

#### 6. Aid-stations creation endpoint

**File**: `src/pages/api/plans/[id]/aid-stations.ts` (new)

**Intent**: Add a station to a plan.

**Contract**: `export const prerender = false`. `POST` — require auth; validate body with `aidStationCreateSchema`; `createAidStation(client, { plan_id: id, ...body })`; a `WITH CHECK` rejection (parent not owned, PostgREST `42501`) maps to `403`; success returns `201` JSON with the created `AidStation`.

#### 7. Aid-station item endpoint

**File**: `src/pages/api/aid-stations/[id].ts` (new)

**Intent**: Delete a station.

**Contract**: `export const prerender = false`. `DELETE` — require auth; `deleteAidStation(client, id)` (RLS hides non-owned rows → idempotent no-op); return `204`.

#### 8. Protect plan routes

**File**: `src/middleware.ts` (modify)

**Intent**: Gate the editor pages behind auth.

**Contract**: add `"/plans"` to `PROTECTED_ROUTES`. (API routes self-guard per the endpoints above.)

#### 9. Backend integration + schema tests

**File**: `tests/integration/plans-flow.test.ts` (new)

**Intent**: Prove the new write paths and validation without an HTTP harness — endpoints are thin wrappers over services + schemas, which are tested directly (the full HTTP path is covered by the Phase 3 e2e). Mirrors F-01's local-Supabase setup.

**Contract**: schema unit assertions (valid input passes; negative numbers, empty name, bad datetime, unknown keys rejected). Integration (two users via admin, signed-in clients): `createDraftPlan` inserts a row satisfying every NOT-NULL column; runner B's `createAidStation` onto A's plan is rejected (`42501`); B's `deleteAidStation` of A's station is a no-op and A's station survives; A can create + delete its own station. Teardown deletes the test users (cascades).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Integration + schema tests pass against local Supabase: `npx vitest run tests/integration/plans-flow.test.ts`

#### Manual Verification:

- While logged in, `POST /api/plans` creates a draft and redirects to `/plans/<id>`; the draft row has seeded defaults.
- A `PATCH /api/plans/<id>` with valid JSON persists; an invalid body returns `400`.
- Unauthenticated requests to the new endpoints return `401`.

**Implementation Note**: After this phase and its automated verification pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Server-rendered pages & navigation

### Overview

The editor page (SSR-loads its plan + stations) and the dashboard rebuilt as a minimal owned-plans list with a New-plan entry. No client interactivity yet — these render current data correctly.

### Changes Required:

#### 1. Plan editor page

**File**: `src/pages/plans/[id].astro` (new)

**Intent**: Load one plan and its stations server-side and host the (Phase 3) islands; this is the per-plan URL the runner returns to.

**Contract**: read `Astro.params.id` and `Astro.locals.user` (guaranteed by middleware); `createClient`; `getPlan(client, id)` → if `null` (missing or not owned, RLS), `redirect` to `/dashboard`; `listAidStations(client, id)`. Render inside `Layout`, passing the plan and stations as initial props to placeholder regions where the Phase 3 islands mount. Static for now.

#### 2. Dashboard: plan list + New plan

**File**: `src/pages/dashboard.astro` (modify)

**Intent**: Give the runner a way to create a plan and navigate back to existing ones (the US-08 "returning" guarantee).

**Contract**: `createClient`; `listPlans(client)`. Render a **New plan** control as a `method="POST"` form to `/api/plans`. If the runner has plans, list them (name + `updated_at`, each linking to `/plans/<id>`, ordered by `updated_at` desc per `listPlans`); otherwise show an empty-state prompt to create the first plan. Keep the existing sign-out control.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Production build compiles the new/changed pages: `npm run build`

#### Manual Verification:

- `/dashboard` shows the New-plan button and either the plan list or the empty state.
- Clicking **New plan** creates a draft and lands on `/plans/<id>` showing the seeded defaults.
- Visiting `/plans/<id>` for a non-owned or nonexistent id redirects to `/dashboard`.
- Hitting `/plans/<id>` or `/dashboard` unauthenticated redirects to `/auth/signin`.

**Implementation Note**: After this phase and its automated verification pass, pause for manual confirmation before Phase 3.

---

## Phase 3: Interactive islands + e2e

### Overview

Make the editor live: a debounced-autosave parameter form and an add/delete aid-station manager, plus a Playwright test of the full flow.

### Changes Required:

#### 1. Autosave hook

**File**: `src/components/hooks/useAutosave.ts` (new)

**Intent**: Reusable debounced-save state machine so both the param form (and future slices) share one autosave contract.

**Contract**: `useAutosave(saveFn)` debounces calls (~600–800ms), coalesces rapid edits, runs `saveFn`, and exposes `status: "idle" | "saving" | "saved" | "error"` plus a `schedule(payload)` trigger. Serializes overlapping saves (latest-wins) and surfaces `error` on a failed/`!ok` response. No `"use client"` directive (CLAUDE.md); standard React.

#### 2. Race-setup param form island

**File**: `src/components/plans/RaceSetupForm.tsx` (new)

**Intent**: Edit race parameters with silent autosave.

**Contract**: props = the initial `Plan`. Controlled fields for name, total distance, elevation gain/loss, start time, hourly fluid/carb/sodium, and **two** expected-finish fields (hours + minutes) seeded from `total_expected_minutes` and recombined to minutes (`h*60+m`) on change. On any change, `schedule()` a `PATCH /api/plans/<id>` with the changed param(s) (numbers parsed from inputs). Render the `useAutosave` `status` as a subtle passive indicator. Reuse `FormField` where it fits.

#### 3. Aid-station manager island

**File**: `src/components/plans/AidStationManager.tsx` (new)

**Intent**: Add, list (sorted), and delete aid stations.

**Contract**: props = `planId` and the initial `AidStation[]`. An inline add-row (cumulative distance, cumulative elevation gain, time at station, six facility checkboxes, notes) `POST`s to `/api/plans/<planId>/aid-stations`; on success the returned station is appended and the list re-sorted by `cumulative_distance_km` asc. Each listed station has a delete control that `DELETE`s `/api/aid-stations/<id>` and removes it on success. No confirmation dialog (US-05). Cumulative distance + elevation required before add is enabled.

#### 4. Mount islands in the editor

**File**: `src/pages/plans/[id].astro` (modify)

**Intent**: Hydrate the two islands with the SSR-loaded data.

**Contract**: mount `RaceSetupForm` (with the plan) and `AidStationManager` (with `planId` + stations) using a client directive (e.g. `client:load`), replacing the Phase 2 placeholders.

#### 5. End-to-end flow test

**File**: `tests/plans-setup.spec.ts` (new)

**Intent**: Exercise the real slice through the browser.

**Contract**: gated on `TEST_EMAIL` / `TEST_PASSWORD` via `test.skip` (mirrors `tests/auth.spec.ts`); sign in, create a new plan, fill parameters, assert reload persists them (autosave), add two stations out of distance order and assert they render sorted, delete one and assert immediate removal. Deletes the stations it created; an abandoned draft plan is left behind (plan deletion is S-05) — documented as a known limitation. Best run against local Supabase to avoid polluting the remote project.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- E2e flow passes with test credentials: `npx playwright test tests/plans-setup.spec.ts`

#### Manual Verification:

- Editing any param shows Saving → Saved; reloading the page shows the persisted values.
- Hours+minutes round-trip losslessly to stored minutes (e.g. 25h 30m).
- Adding stations out of order lists them in cumulative-distance order; delete removes immediately, no dialog.
- A simulated save failure (offline) surfaces the error indicator without a blocking dialog.
- Layout is usable at mobile width.

**Implementation Note**: After this phase and its automated verification pass, pause for final manual confirmation.

---

## Testing Strategy

### Integration / Unit (Vitest, Phase 1):

- zod schemas: accept valid, reject negative numbers, empty name, malformed datetime, unknown keys.
- `createDraftPlan` produces a row satisfying every NOT-NULL column.
- New write-path RLS: cross-user station create rejected (`42501`); cross-user station delete is a no-op; owner can create + delete.

### End-to-end (Playwright, Phase 3):

- Create plan → enter params → reload → values persist (autosave).
- Add stations out of order → sorted by cumulative distance.
- Delete station → removed immediately.

### Manual Testing Steps:

1. Log in, create a plan, type parameters, watch the save indicator, reload, confirm persistence.
2. Add several stations (including out of order), confirm sort; delete one, confirm immediate update.
3. Go offline mid-edit; confirm the error indicator appears and no data is silently lost.

## Performance Considerations

NFR data volume is small. Autosave debounce (~600–800ms) plus latest-wins coalescing keeps PATCH traffic low. The dashboard list and per-plan station list are tiny (PRD: up to ~50 stations) and served by the F-01 `plans(user_id)` / `aid_stations(plan_id)` indexes.

## Migration Notes

No schema migration. The NOT-NULL parameter columns from F-01 are satisfied by seeded draft defaults (`createDraftPlan`); no existing data to migrate.

## References

- Roadmap: `context/foundation/roadmap.md` → S-01 (race-setup-and-aid-stations)
- PRD: `context/foundation/prd.md` → US-04, US-05, US-08, FR-003, FR-005, FR-006, FR-008
- Data layer (F-01, archived): `context/archive/2026-06-03-plan-data-and-ownership/plan.md`; services `src/lib/services/plans.ts`, `src/lib/services/aid-stations.ts`; types `src/types.ts`
- Patterns: `src/pages/api/auth/signup.ts`, `src/components/auth/SignUpForm.tsx`, `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — validated API + service/middleware wiring

#### Automated

- [x] 1.1 Type checking passes (`npx tsc --noEmit`) — e9c033b
- [x] 1.2 Lint passes (`npm run lint`) — e9c033b
- [x] 1.3 Integration + schema tests pass (`npx vitest run tests/integration/plans-flow.test.ts`) — e9c033b

#### Manual

- [x] 1.4 `POST /api/plans` (logged in) creates a seeded draft and redirects to `/plans/<id>` — e9c033b
- [x] 1.5 `PATCH /api/plans/<id>` persists valid JSON; invalid body returns 400 — e9c033b
- [x] 1.6 Unauthenticated requests to the new endpoints return 401 — e9c033b

### Phase 2: Server-rendered pages & navigation

#### Automated

- [x] 2.1 Type checking passes (`npx tsc --noEmit`) — a2f588c
- [x] 2.2 Lint passes (`npm run lint`) — a2f588c
- [x] 2.3 Production build compiles the new/changed pages (`npm run build`) — a2f588c

#### Manual

- [x] 2.4 `/dashboard` shows New-plan button and plan list or empty state — a2f588c
- [x] 2.5 New plan creates a draft and lands on `/plans/<id>` with seeded defaults — a2f588c
- [x] 2.6 Non-owned / nonexistent `/plans/<id>` redirects to `/dashboard` — a2f588c
- [x] 2.7 Unauthenticated `/plans/<id>` and `/dashboard` redirect to `/auth/signin` — a2f588c

### Phase 3: Interactive islands + e2e

#### Automated

- [x] 3.1 Type checking passes (`npx tsc --noEmit`)
- [x] 3.2 Lint passes (`npm run lint`)
- [x] 3.3 Production build succeeds (`npm run build`)
- [x] 3.4 E2e flow passes with test credentials (`npx playwright test tests/plans-setup.spec.ts`)

#### Manual

- [x] 3.5 Editing a param shows Saving → Saved; reload shows persisted values
- [x] 3.6 Hours+minutes round-trip losslessly to stored minutes
- [x] 3.7 Out-of-order stations list sorted by cumulative distance; delete is immediate with no dialog
- [x] 3.8 Simulated save failure surfaces the error indicator without a blocking dialog
- [x] 3.9 Layout usable at mobile width

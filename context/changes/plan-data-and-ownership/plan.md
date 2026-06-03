# Plan Persistence + Per-User Ownership (F-01) Implementation Plan

## Overview

Establish the data foundation for Ultra Planner: the project's first Supabase migration creating `plans` and `aid_stations` tables, owner-scoped via Row-Level Security so a runner can only read or write their own data. Ship hand-written entity types in `src/types.ts` and a thin, RLS-enforcing data-access layer in `src/lib/services/`, then prove owner isolation with a two-user integration test. No UI and no API routes — those belong to S-01.

## Current State Analysis

- **No data layer exists.** `supabase/` contains only `config.toml`; there is no `supabase/migrations/` directory. This change creates the project's first migration.
- **Auth scaffold is present and clean.** `src/lib/supabase.ts:5` exposes `createClient(headers, cookies)` returning an `@supabase/ssr` cookie-based client (or `null` when env is unset). `src/middleware.ts:11` resolves `context.locals.user`; `src/env.d.ts` types `App.Locals.user` as a Supabase `User`. New tables FK to `auth.users(id)`.
- **No `src/types.ts` yet.** CLAUDE.md mandates shared entity/DTO types live there — this change introduces the file.
- **Strict RLS convention** (CLAUDE.md): one policy per operation (SELECT/INSERT/UPDATE/DELETE) per role; never `FOR ALL` or `USING (true)` on user data. `aid_stations` has no direct `user_id`, so ownership is expressed through `plan_id → plans.user_id`.
- **Tooling**: `supabase` CLI is already a devDependency (package.json:54). No test runner beyond Playwright (package.json:39); Vitest must be added for the isolation test. Migration naming is fixed: `YYYYMMDDHHmmss_short_description.sql`.

## Desired End State

After this plan:

- `npx supabase db reset` (or `db push`) applies a migration that creates `plans` and `aid_stations` with RLS enabled and one policy per operation for the `authenticated` role.
- An authenticated runner can insert/select/update/delete only their own `plans` and the `aid_stations` belonging to those plans; another runner's client is denied on every operation.
- `src/types.ts` exports `Plan`, `AidStation`, and their Insert/Update DTO shapes, matching the migration column-for-column.
- `src/lib/services/plans.ts` and `src/lib/services/aid-stations.ts` expose typed CRUD helpers that take the request-scoped SSR client, so RLS governs every query (defense in depth).
- A Vitest integration test seeds two users against local Supabase and asserts cross-user reads/writes/deletes fail.

Verify by: running the migration cleanly against a fresh local DB, `npx tsc`/lint passing, and the isolation test passing (`npx vitest run`).

### Key Discoveries:

- Request-scoped client pattern to reuse: `src/lib/supabase.ts:5` (`createClient(headers, cookies)`), already consumed in `src/pages/api/auth/signup.ts:9`.
- Ownership for the child table must be a subquery — there is no `user_id` on `aid_stations` by design (single source of truth = the parent plan).
- `numeric` (not `double precision`) for all measurements: PRD names calculation accuracy as a non-negotiable guardrail; float rounding is a regression risk.
- Finish time is stored as whole minutes (`total_expected_minutes integer`); hh:mm maps losslessly to minutes (25:30 → 1530), avoiding the decimal-hours rounding that non-divisible minutes (e.g. 25:20) would incur. The hh:mm input UX and conversion are S-01's form concern; the Business Logic divides by 60 where it needs hours.

## What We're NOT Doing

- **No gear profile** — deferred to S-03 (roadmap scope guard).
- **No API routes or UI** — S-01 owns the race-setup form, autosave wiring, and endpoints.
- **No persisted generated-plan-table** — S-02 generates and S-04 persists/displays the computed table; this slice stores only inputs.
- **No CI integration of the isolation test** — it requires Supabase-in-CI infrastructure; left as a follow-up. Verification here is local against `supabase start`.
- **No edit/rename surface** (FR-010 is v2). No seed/demo data beyond what the test creates.

## Implementation Approach

Three sequential phases: migration first (the contract everything else mirrors), then types + data-access derived from it, then the isolation test that exercises the policies through the same SSR client the app uses. Each phase is independently verifiable; the migration and types must agree column-for-column, so they are reviewed together even though authored in sequence.

## Critical Implementation Details

- **RLS policy roles**: policies target the `authenticated` role and use `auth.uid()`. Do not add `anon` policies — unauthenticated access must be denied entirely.
- **Child-table policy shape**: every `aid_stations` policy (all four operations) gates on `plan_id IN (SELECT id FROM plans WHERE user_id = auth.uid())`. INSERT must enforce this via `WITH CHECK`; UPDATE needs both `USING` and `WITH CHECK`.
- **moddatetime ordering**: enable the `moddatetime` extension before creating the `BEFORE UPDATE` triggers that reference it.
- **Cascade**: `aid_stations.plan_id` references `plans(id)` `ON DELETE CASCADE` so deleting a plan removes its stations (supports S-05 later).

## Phase 1: Database schema + RLS migration

### Overview

Create the first migration: extension, both tables, `updated_at` triggers, RLS policies, and FK indexes.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_create_plans_and_aid_stations.sql`

**Intent**: Define the two-table schema with owner-scoped RLS and automatic `updated_at` maintenance — the persistent contract S-01/S-02/S-04/S-05 build on.

**Contract**:

- Enable extension `moddatetime` (schema `extensions`).
- `plans`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `name text not null`, `total_distance_km numeric not null`, `total_elevation_gain_m numeric not null`, `total_elevation_loss_m numeric not null`, `start_time timestamptz not null`, `total_expected_minutes integer not null`, `hourly_fluid_ml numeric not null`, `hourly_carb_g numeric not null`, `hourly_sodium_mg numeric not null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- `aid_stations`: `id uuid pk default gen_random_uuid()`, `plan_id uuid not null references plans(id) on delete cascade`, `cumulative_distance_km numeric not null`, `cumulative_elevation_gain_m numeric not null`, `time_spent_min numeric not null default 0`, six boolean facility flags (`water_only`, `food_available`, `warm_meal`, `drop_bag_available`, `rest_area`, `support_crew_allowed`) `not null default false`, `notes text`, `created_at`/`updated_at` as above.
- `BEFORE UPDATE` `moddatetime(updated_at)` trigger on each table.
- Indexes: `plans(user_id)`, `aid_stations(plan_id)`.
- `alter table ... enable row level security` on both.
- Eight policies on `plans` and `aid_stations` (4 each) for role `authenticated`. `plans`: `user_id = auth.uid()` (`USING` for select/update/delete, `WITH CHECK` for insert/update). `aid_stations`: `plan_id IN (SELECT id FROM plans WHERE user_id = auth.uid())` with the same USING/WITH CHECK split. One named policy per operation — no `FOR ALL`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a fresh DB: `npx supabase db reset`
- Both tables report `rowsecurity = true` and exactly 4 policies each (verify via `npx supabase db reset` output / a `psql` catalog query in the test setup)
- Lint passes: `npm run lint`

#### Manual Verification:

- Inspecting the schema in Supabase Studio shows both tables, the FK cascade, the two `updated_at` triggers, and 8 RLS policies named per operation
- Updating any row bumps `updated_at` automatically

**Implementation Note**: After this phase and its automated verification pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Entity types + data-access layer

### Overview

Hand-write the entity/DTO types and a thin RLS-enforcing data-access layer that mirrors the migration.

### Changes Required:

#### 1. Shared entity + DTO types

**File**: `src/types.ts` (new)

**Intent**: Provide `Plan` and `AidStation` row types plus Insert/Update DTOs so the service layer and downstream slices share one typed contract.

**Contract**: Export `Plan`, `AidStation` (camelCase or snake-case matching the chosen Supabase row convention — match what the SSR client returns, i.e. snake_case columns), and `PlanInsert`/`PlanUpdate`, `AidStationInsert`/`AidStationUpdate` (omit `id`/`created_at`/`updated_at`; `Insert` omits server-defaulted fields, `Update` is `Partial`). Fields and units mirror the migration column-for-column.

#### 2. Plans data-access module

**File**: `src/lib/services/plans.ts` (new)

**Intent**: Typed CRUD over `plans`, executed through the request-scoped SSR client so RLS enforces ownership on every call.

**Contract**: Functions accept the `SupabaseClient` from `createClient(headers, cookies)` as the first arg, e.g. `listPlans(client)`, `getPlan(client, id)`, `createPlan(client, input: PlanInsert)`, `updatePlan(client, id, patch: PlanUpdate)`, `deletePlan(client, id)`. No `user_id` is passed or filtered in app code — RLS scopes it. Return typed rows / throw on Supabase error.

#### 3. Aid-stations data-access module

**File**: `src/lib/services/aid-stations.ts` (new)

**Intent**: Typed CRUD over `aid_stations` scoped to a plan, RLS-enforced.

**Contract**: `listAidStations(client, planId)` (ordered by `cumulative_distance_km` asc), `createAidStation(client, input: AidStationInsert)`, `updateAidStation(client, id, patch)`, `deleteAidStation(client, id)`. Ownership flows through the parent-plan RLS subquery; no manual user filtering.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` (and `npx astro sync` first if env types are stale)
- Lint passes: `npm run lint`

#### Manual Verification:

- Types in `src/types.ts` match the migration columns one-to-one (manual diff)
- Service function signatures take the request-scoped client and never reference `user_id`

**Implementation Note**: After this phase and its automated verification pass, pause for manual confirmation before Phase 3.

---

## Phase 3: RLS isolation verification

### Overview

Add Vitest and a two-user integration test proving owner isolation against local Supabase.

### Changes Required:

#### 1. Vitest setup

**File**: `package.json`, `vitest.config.ts` (new)

**Intent**: Introduce a test runner for node-side integration tests, separate from Playwright e2e.

**Contract**: Add `vitest` (and `@vitest/...` as needed) to devDependencies; add a `"test"` (or `"test:integration"`) script. Config targets a `tests/integration/` glob so Playwright's `tests/*.spec.ts` are not picked up. Test reads local Supabase URL + anon/service keys from env (`.dev.vars`/`.env`), documented in the test header.

#### 2. Owner-isolation test

**File**: `tests/integration/rls-ownership.test.ts` (new)

**Intent**: Assert RLS blocks cross-user access through the same client type the app uses.

**Contract**: Setup creates two users (A, B) via Supabase admin/signUp and signs each in to get a session-scoped client. Assertions: (a) A creates a plan + aid station; (b) B's `select`/`update`/`delete` on A's plan returns zero rows / no-op (RLS hides them); (c) B's insert of an aid station referencing A's plan is rejected by the `WITH CHECK` subquery; (d) A can read its own rows. Teardown removes the test users/rows.

### Success Criteria:

#### Automated Verification:

- Local Supabase running (`npx supabase start`), then isolation test passes: `npx vitest run tests/integration/rls-ownership.test.ts`
- Lint passes: `npm run lint`

#### Manual Verification:

- Temporarily disabling one policy makes the corresponding assertion fail (confirms the test actually exercises RLS, not just empty tables)

**Implementation Note**: After this phase and its automated verification pass, pause for final manual confirmation.

---

## Testing Strategy

### Integration Tests (Vitest):

- Cross-user SELECT/UPDATE/DELETE denial on `plans` and `aid_stations`
- Cross-user INSERT denial on `aid_stations` (parent-plan `WITH CHECK`)
- Owner can CRUD their own rows
- Edge: aid station referencing a non-owned plan id is rejected

### Manual Testing Steps:

1. `npx supabase db reset`, open Studio, confirm tables/triggers/policies.
2. Insert a row and update it; confirm `updated_at` advances.
3. Run the isolation test; flip one policy off to confirm it fails as expected.

## Performance Considerations

MVP data volume is small (PRD `data_volume: small`). The `aid_stations` ownership subquery is negligible at this scale; the `aid_stations(plan_id)` and `plans(user_id)` indexes keep lookups efficient.

## Migration Notes

This is the first migration; no existing data to migrate. The migration must be idempotent-safe under `db reset` (clean create). Down-migration is not required for MVP.

## References

- Roadmap: `context/foundation/roadmap.md` → F-01
- PRD: `context/foundation/prd.md` (FR-003, FR-005, FR-008, Access Control, NFR privacy, Business Logic)
- Request-scoped client: `src/lib/supabase.ts:5`; consumer example `src/pages/api/auth/signup.ts:9`
- Convention: `CLAUDE.md` → Supabase migrations + Supabase security

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database schema + RLS migration

#### Automated

- [x] 1.1 Migration applies cleanly against a fresh DB (`npx supabase db reset`) — f25ae5c
- [x] 1.2 Both tables report `rowsecurity = true` with exactly 4 policies each — f25ae5c
- [ ] 1.3 Lint passes (`npm run lint`)

#### Manual

- [x] 1.4 Studio shows both tables, FK cascade, two `updated_at` triggers, 8 named policies — f25ae5c
- [x] 1.5 Updating any row bumps `updated_at` automatically — f25ae5c

### Phase 2: Entity types + data-access layer

#### Automated

- [x] 2.1 Type checking passes (`npx tsc --noEmit`)
- [ ] 2.2 Lint passes (`npm run lint`)

#### Manual

- [x] 2.3 Types in `src/types.ts` match the migration columns one-to-one
- [x] 2.4 Service functions take the request-scoped client and never reference `user_id`

### Phase 3: RLS isolation verification

#### Automated

- [ ] 3.1 Isolation test passes against local Supabase (`npx vitest run tests/integration/rls-ownership.test.ts`)
- [ ] 3.2 Lint passes (`npm run lint`)

#### Manual

- [ ] 3.3 Disabling one policy makes the corresponding assertion fail (confirms the test exercises RLS)

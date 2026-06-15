# Plan Persistence + Per-User Ownership (F-01) — Plan Brief

> Full plan: `context/changes/plan-data-and-ownership/plan.md`

## What & Why

Ultra Planner has auth but no data layer. This slice creates the project's first Supabase migration — `plans` and `aid_stations` tables — owner-scoped via Row-Level Security so a runner can only ever touch their own data. It's the foundation the wedge depends on: S-01 (race setup) writes here, S-02 (generation) reads here, S-04/S-05 (dashboard + delete) list and remove these rows.

## Starting Point

Auth is in place (Supabase SSR cookie client at `src/lib/supabase.ts`, middleware resolving `context.locals.user`). But `supabase/` has only `config.toml` — no migrations, no schema, no `src/types.ts`. We're building the data layer from zero on top of the existing `auth.users`.

## Desired End State

A runner's plans and aid stations live server-side. The DB itself enforces that user B can never read, edit, or delete user A's data — proven by an automated two-user test. Downstream slices get a typed, RLS-safe data-access layer to build on, and `src/types.ts` exists as the shared-types home CLAUDE.md mandates.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Slice scope | Schema + RLS + types + data-access layer (no UI/API) | Gives S-01 a tested CRUD surface without overbuilding | Plan |
| Child-table RLS | `aid_stations` ownership via subquery to `plans` | Single source of truth (the plan); no denormalized `user_id` to drift | Plan |
| Types | Hand-written in `src/types.ts` | Matches CLAUDE.md convention; no new codegen/CI dep | Plan |
| `updated_at` | DB trigger (`moddatetime`) | Auto-save can't forget it; correct for any writer | Plan |
| RLS verification | Vitest two-user integration test (local Supabase) | Exercises real policies through the app's client; satisfies privacy NFR | Plan |
| DB client | Request-scoped SSR client (RLS enforced) | Defense in depth — DB guarantees ownership even if app code forgets a filter | Plan |
| Numerics | `numeric` cols; finish time = integer minutes; km / meters | Exact math (PRD accuracy guardrail); hh:mm maps losslessly to minutes | Plan / User |

## Scope

**In scope:** first migration (2 tables, RLS, triggers, indexes); `Plan`/`AidStation` + DTO types; `src/lib/services/` CRUD helpers; two-user isolation test.

**Out of scope:** gear profile (S-03), API routes + UI + autosave wiring (S-01), persisted generated table (S-02/S-04), edit/rename (v2), CI integration of the isolation test (follow-up).

## Architecture / Approach

`plans` FK to `auth.users` with `user_id = auth.uid()` policies; `aid_stations` FK to `plans` (`ON DELETE CASCADE`) with policies gating on `plan_id IN (SELECT id FROM plans WHERE user_id = auth.uid())`. One named policy per operation per `authenticated` role — never `FOR ALL`. Service functions take the per-request SSR client, so every query runs under the user's session and RLS does the scoping; app code never filters by `user_id`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + RLS migration | First migration: tables, triggers, 8 policies, indexes | Child-table policy must use `WITH CHECK` on INSERT/UPDATE, not just `USING` |
| 2. Types + data-access layer | `src/types.ts` + `src/lib/services/` CRUD | Types must mirror migration columns exactly |
| 3. RLS isolation test | Vitest two-user denial test vs local Supabase | Test must fail when a policy is removed (else it's testing empty tables) |

**Prerequisites:** local Supabase (`npx supabase start`, Docker); `supabase` CLI already a devDependency.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Vitest is new to the repo; Phase 3 adds it as a devDependency alongside Playwright (kept on a separate test glob).
- Isolation test runs locally only; wiring Supabase into CI is deferred.
- hh:mm finish-time input/conversion is assumed to land in S-01's form; the DB stores decimal hours.

## Success Criteria (Summary)

- A fresh `npx supabase db reset` creates both tables with RLS on and 4 policies each.
- The two-user isolation test passes: user B is denied read/update/delete/insert against user A's data.
- Type-check and lint pass; `src/types.ts` and the migration agree column-for-column.

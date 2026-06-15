# Race Setup + Aid Stations (S-01) — Plan Brief

> Full plan: `context/changes/race-setup-and-aid-stations/plan.md`

## What & Why

Give a logged-in runner the "build a plan" experience: create a draft, enter race parameters with silent autosave, and add/list/delete aid stations. This is roadmap slice S-01 — the setup half of the four-step flow that the north-star generation slice (S-02) reads from. It delivers FR-003, FR-005, FR-006, FR-008 (US-04, US-05, US-08).

## Starting Point

The F-01 data layer is done and archived: `plans` + `aid_stations` with owner-scoped RLS and typed CRUD services (`src/lib/services/{plans,aid-stations}.ts`). Auth, middleware (`context.locals.user`, `PROTECTED_ROUTES`), and a React-island-form-over-API-route pattern (`auth/SignUpForm.tsx` → `api/auth/signup.ts`) all exist. The dashboard is a placeholder; there are no plan routes yet.

## Desired End State

From `/dashboard` the runner sees their plans (or an empty-state) and a **New plan** button. Creating one lands them on `/plans/<id>`, where editing parameters autosaves silently (subtle saving/saved indicator) and survives reload, and aid stations can be added (inline row) and deleted, always shown in cumulative-distance order. No generated table, gear, or read-only view yet.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Backend transport | JSON API routes wrapping F-01 services | Reuses the cookie-session + RLS path the app already uses; services exist | Plan |
| Draft lifecycle | Server-create draft on "New plan", redirect to `/plans/[id]` | A real `plan_id` exists immediately so stations + autosave have a target | Plan |
| Partial-draft persistence | Seed safe defaults at draft creation | Satisfies F-01's NOT-NULL columns with no migration | Plan |
| Save feedback | Subtle passive indicator | Honors US-08 "silent" while still reassuring the runner; flags save failures | Plan |
| Finish-time input | Two fields (hours + minutes) → minutes | Unambiguous, lossless to the stored integer, no mask parsing | Plan |
| Aid-station UX | Inline add-row + distance-sorted list with delete | Fast roadbook entry; matches add/delete-only, sorted, no-confirm requirements | Plan |
| Dashboard scope | Minimal plan list + New plan | Lets a returning runner reach a draft (US-08) with minimal overlap with S-04 | Plan |
| Testing | Vitest endpoint/RLS integration + Playwright e2e | Covers the server contract and the real autosave/flow | Plan |

## Scope

**In scope:** draft creation; race-parameter autosave; aid-station add/list/delete; minimal dashboard list + New-plan entry; `/plans` route protection; zod validation; endpoint + e2e tests.

**Out of scope:** segment/plan-table generation (S-02), gear profile (S-03), read-only saved-plan view / polished dashboard (S-04), plan deletion (S-05), inline station edit / plan rename (v2), any schema migration.

## Architecture / Approach

Server pages load data via the F-01 services and hydrate two React islands. The param-form island debounces edits through a `useAutosave` hook and `PATCH /api/plans/[id]`; the station island `POST`s/`DELETE`s to `/api/plans/[id]/aid-stations` and `/api/aid-stations/[id]`. Every endpoint checks `context.locals.user` (401), validates with zod (400), and relies on RLS as defense-in-depth. "New plan" and sign-out stay as classic form POSTs.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | zod schemas, 4 endpoints, `createDraftPlan`, `/plans` protection, Vitest tests | NOT-NULL drafts; getting endpoint auth/RLS error-mapping right |
| 2. Pages | `/plans/[id]` editor (SSR load) + dashboard list & New-plan entry | Owner/redirect handling for non-owned ids |
| 3. Islands + e2e | Autosave param form, aid-station manager, `useAutosave`, Playwright flow | Debounce/coalescing correctness; silent-save error surfacing |

**Prerequisites:** F-01 (done/archived); local Supabase for Vitest; `TEST_EMAIL`/`TEST_PASSWORD` for the e2e.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- Seeded-default drafts mean a half-filled plan holds `0`/placeholder values until completed; "completeness" is really gated by S-02 generation, so this is acceptable.
- Abandoned drafts accumulate (no plan delete until S-05).
- The e2e needs a real session; run it against local Supabase to avoid polluting the remote project.
- `zod` is a new dependency.

## Success Criteria (Summary)

- A runner creates a plan, enters parameters that autosave and survive reload, and adds/deletes aid stations that stay distance-sorted — all owner-private.
- Vitest (RLS + validation) and the Playwright flow pass; `tsc`, `lint`, and `build` are clean.

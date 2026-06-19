---
project: "Ultra Planner"
version: 2
status: draft
created: 2026-06-01
updated: 2026-06-19
prd_version: 5
main_goal: speed
top_blocker: capacity
---

# Roadmap: Ultra Planner

> Derived from `context/foundation/prd.md` (v2) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Building an ultra-marathon race plan is a workflow problem: every serious runner does it, but estimating segment times and per-segment fluid/carb/sodium needs by hand is slow and error-prone. The product wedge — the one trait that, if removed, makes the product indistinguishable from a generic planner or spreadsheet — is that nutrition is computed **per time-on-feet per segment** (distance + elevation weighted), not as a flat total-distance number. The MVP lets a runner enter race parameters and a heterogeneous aid-station list, then generates a correct segment-by-segment plan table; plans are persisted per account so they survive across devices.

## North star

**S-02: Runner generates a correct segment-by-segment plan table** — this is the validation milestone, because a correct per-segment table is the only thing that proves the wedge (segment-specific nutrition math) actually works; everything else is setup or refinement around it.

> "North star" here means the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — placed as early as its Prerequisites allow because everything else only matters if this works. S-02 depends on S-01 (race setup) and F-01 (persistence), so it ships as soon as those land.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                                                         | Prerequisites | PRD refs                                            | Status   |
| ---- | --------------------------- | -------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------- | -------- |
| F-01 | plan-data-and-ownership     | (foundation) plans & aid stations persisted, owner-scoped via RLS                            | —             | FR-008, NFR (privacy), Access Control               | done     |
| S-01 | race-setup-and-aid-stations | create a race plan and add/list/delete aid stations, auto-saved                              | F-01          | US-04, US-05, US-08, FR-003, FR-005, FR-006, FR-008 | done     |
| S-02 | generate-plan-table         | generate a correct segment-by-segment plan table                                             | S-01          | US-01, FR-007, NFR (instant)                        | done     |
| S-03 | gear-profile-units          | build a gear catalog so the table auto-suggests per-segment fueling units, tunable per stage | S-02          | US-06, FR-004                                       | done     |
| S-04 | plan-dashboard-view         | see saved plans and open one in read-only view                                               | S-02          | US-07, FR-009, US-03                                | done     |
| S-05 | delete-saved-plan           | permanently delete a saved plan with confirmation                                            | S-04          | US-09, FR-011                                       | done     |
| S-06 | email-otp-auth              | sign up / sign in with an emailed one-time code and reach a gated app                        | —             | US-02, US-03, FR-001, FR-002                        | done     |
| S-07 | gpx-import                  | import a GPX route to auto-fill distance/elevation and pre-create aid stations from waypoints | S-01          | (was §Non-Goal; pulled forward to v2)               | done     |
| S-08 | edit-aid-stations           | edit any field of an existing aid station inline; re-sort + recompute segments                | S-01          | US-10, FR-007 (PRD v5)                              | done     |
| S-09 | tooltips                    | see on-hover/focus field-help on the non-obvious plan-form inputs                            | S-02          | (UX enhancement; no PRD change)                     | done     |
| S-10 | public-pages-and-brand      | land on a branded public welcome / about / contact site; sign-in routes to the dashboard     | S-06          | (marketing/UX; no PRD change)                       | done     |
| S-11 | account-deletion            | permanently delete their account + all data, confirmed by an emailed link                    | S-06          | PRD FR TBD (right-to-erasure)                       | todo     |
| S-12 | excel-export                | export a plan to an Excel file                                                               | S-02          | (was §Non-Goal; un-parking)                         | todo     |
| S-13 | collapsible-plan-sections   | collapse / expand the plan-builder sections to cut scrolling                                 | S-01          | (UX enhancement)                                   | todo     |
| S-14 | gear-total-summary          | see race-wide gear totals (units per item) in the plan-table total row                       | S-03          | (UX enhancement)                                   | todo     |

> **Note (2026-06-19):** S-01–S-06 were the original MVP roadmap; S-07–S-14 were added in a `version: 2` reconciliation after several post-MVP changes shipped (some pulled forward from §Non-Goals / §Parked, some net-new). S-07–S-10 are already shipped + archived; S-11–S-14 are the current backlog. Post-MVP bug fixes are listed under `## Done → Maintenance / fixes`.

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain                             | Note                                                                            |
| ------ | ------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| A      | Rdzeń planu (wedge) | `F-01` → `S-01` → `S-02` → `S-03` | Krytyczna ścieżka do gwiazdy; S-03 dekoruje wynik generowania.                  |
| B      | Cykl życia planu    | `S-04` → `S-05`                   | Dołącza do Stream A w `S-02` (potrzebuje wygenerowanego planu do wyświetlenia). |
| C      | Konto               | `S-06`                            | Samodzielny; auth scaffold już obecny (present) — weryfikacja + bramka.         |

## Baseline

What's already in place in the codebase as of `2026-06-01` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 SSR + React 19 islands + Tailwind 4 + shadcn/ui (`src/layouts/Layout.astro`, `src/components/ui/button.tsx`).
- **Backend / API:** present — Astro SSR API routes (`src/pages/api/auth/*.ts`); `output: "server"`.
- **Data:** absent — no migrations, no plan/aid-station schema (`supabase/` has only `config.toml`; no `supabase/migrations`).
- **Auth:** present but **mismatched** — the bootstrapped Supabase scaffold uses email + password (`signInWithPassword`/`signUp`, `confirm-email`, middleware gating `/dashboard` + `/plans`). PRD v4 specifies **passwordless email OTP** (6-digit code), so S-06 **replaces** the password flow with `signInWithOtp`/`verifyOtp` rather than verifying the scaffold.
- **Deploy / infra:** present — Cloudflare Workers, `wrangler.jsonc`, GitHub Actions (`ci.yml`, `deploy.yml`, `playwright.yml`).
- **Observability:** present — Workers Observability enabled (per `infrastructure.md`).

## Foundations

### F-01: Plan persistence + per-user ownership

- **Outcome:** (foundation) plans and aid stations are stored server-side and are readable/writable only by their owning runner.
- **Change ID:** plan-data-and-ownership
- **PRD refs:** FR-008, NFR (no data accessible outside the runner's account), Access Control
- **Unlocks:** S-01 (auto-saved race setup), S-02 (generation reads the persisted plan), S-04/S-05 (dashboard + delete); provides the RLS verification path the privacy NFR requires.
- **Prerequisites:** — (builds on the existing Supabase auth scaffold reported `present` in Baseline)
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Minimal schema (plans + aid_stations) with one RLS policy per operation per role (per project convention); building out the whole data layer now would burn scarce after-hours capacity. Scoped to the north-star path only — the gear table arrives with S-03, not here.
- **Status:** done

## Slices

### S-01: Race setup + aid stations

- **Outcome:** Runner can create a race plan (parameters) and add, list, and delete aid stations, with every change auto-saved.
- **Change ID:** race-setup-and-aid-stations
- **PRD refs:** US-04, US-05, US-08, FR-003, FR-005, FR-006, FR-008
- **Prerequisites:** F-01
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The cumulative→segment derivation (distance & elevation subtracted across consecutive stations) is the data-entry foundation the calc depends on; correctness here prevents downstream calc errors. Sequenced before generation because the table needs persisted stations. Race parameters now include total expected finish time (PRD v2 FR-003), which the calc consumes. New plan routes must be added to the middleware `PROTECTED_ROUTES`.
- **Status:** done

### S-02: Generate plan table

- **Outcome:** Runner can generate a correct segment-by-segment plan table — per-segment travel time, estimated clock arrival, and fluid/carb/sodium targets, with aid-station context inline.
- **Change ID:** generate-plan-table
- **PRD refs:** US-01, FR-007, NFR (plan table appears within 1s for up to 50 aid stations)
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Zero-aid-station case must render an explanatory state, not a broken/empty table (US-01 AC). Owner: team. Block: no.
- **Risk:** This is the wedge and the calculation-accuracy guardrail lives here — a wrong nutrition number is actively harmful (PRD Guardrail), so this slice is isolated to let its correctness be verified independently. The algorithm is fully specified in Business Logic (Naismith weight, k = 0.01 km/m), removing implementation ambiguity.
- **Status:** done

### S-03: Gear catalog → per-segment fueling units (hybrid)

- **Outcome:** Runner can optionally build a per-plan gear catalog (gels, carb drink, solid food, water carrier, salt caps); the plan table then auto-suggests whole-unit fueling per segment (carb-led, ratio-weighted, with fluid/sodium gap-fill) and lets the runner cap a product or pin an exact override per stage, showing achieved-vs-target with a signed delta. With no gear, the table stays in gram/ml/mg targets.
- **Change ID:** gear-profile-units
- **PRD refs:** US-06, FR-004
- **Prerequisites:** S-02
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** A pure allocation transform + two owner-scoped tables (catalog + sparse per-segment selections) decorate the existing calc output — it must not alter the underlying gram/ml/mg math, only present and compare against it. Sequenced after generation because it decorates the generated table.
- **Scope note (2026-06-16):** Implemented as a **hybrid** (auto-suggest + per-segment limits and overrides) with sodium as a third unit-mapped target — broader than the original one-way gram→unit transform. PRD FR-004/US-06 updated to match (prd v3).
- **Status:** done

### S-04: Plan dashboard (view saved plans)

- **Outcome:** Runner can see all their saved plans on a dashboard and open one in read-only view; a runner with no plans sees an empty-state prompt to create their first plan.
- **Change ID:** plan-dashboard-view
- **PRD refs:** US-07, FR-009, US-03 (empty-dashboard acceptance criterion)
- **Prerequisites:** S-02
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Read-only view only — full editing of saved-plan parameters is v2 (Parked). The table must render as last generated without re-triggering generation. Low risk: mostly a listing + read view over already-persisted data.
- **Status:** done

### S-05: Delete saved plan

- **Outcome:** Runner can permanently delete a saved plan from the dashboard after explicitly confirming in a dialog.
- **Change ID:** delete-saved-plan
- **PRD refs:** US-09, FR-011
- **Prerequisites:** S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Hard delete with a confirmation dialog; no undo in MVP (Parked). The confirmation dialog is the only guard against accidental loss. Depends on the dashboard list existing.
- **Status:** done

### S-06: Account access (passwordless email OTP)

- **Outcome:** Runner can sign up / sign in with a 6-digit one-time code emailed to them, sign out, and is redirected to the sign-in screen when reaching a gated route unauthenticated. No password is stored.
- **Change ID:** email-otp-auth
- **PRD refs:** US-02, US-03, FR-001, FR-002
- **Prerequisites:** —
- **Parallel with:** F-01, S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The present scaffold is password-based, so this slice **replaces** it with the OTP flow (`signInWithOtp` → emailed 6-digit code → `verifyOtp`) rather than verifying it. Sign-up and sign-in unify into one flow (no separate signup form, no password-reset, no `confirm-email` step). The main thing to validate end-to-end is Supabase email OTP + SSR cookie handling on Cloudflare Workers (see infrastructure.md risk register).
- **Status:** done

### S-07: GPX import

- **Outcome:** Runner can upload a GPX route to auto-fill total distance and elevation gain/loss, and pre-create an aid station from every waypoint in the file (manual entry still available when there are no waypoints).
- **Change ID:** gpx-import
- **PRD refs:** was §Non-Goals ("GPX parsing is the primary MVP-complexity driver, deferred to v2+") — pulled forward and shipped.
- **Prerequisites:** S-01
- **Status:** done

### S-08: Edit an existing aid station

- **Outcome:** Runner can edit any field of a saved aid station inline (cumulative distance/elevation, time, facilities, crew notes), re-sorted if distance changed and with affected segments recomputed.
- **Change ID:** edit-aid-stations
- **PRD refs:** US-10, FR-007 (added PRD v5, 2026-06-18)
- **Prerequisites:** S-01
- **Note:** Motivated by S-07 — waypoint import creates bare stations (distance/elevation/name only), so edit is the path to enrich them.
- **Status:** done

### S-09: Field-help tooltips

- **Outcome:** Runner sees a small "?" affordance on the non-obvious plan-form inputs that, on hover / keyboard-focus / touch, explains the field (cumulative vs total distance, hourly targets, carb ratio, etc.).
- **Change ID:** tooltips
- **PRD refs:** none — UX enhancement, not a scope/non-goal item.
- **Prerequisites:** S-02
- **Status:** done

### S-10: Public pages + brand

- **Outcome:** A visitor lands on a custom branded welcome page (mountain-outline "Summit at first light" direction) with public About + Contact pages; sign-in routes to the dashboard, and a shared auth-aware nav spans public and app pages.
- **Change ID:** public-pages-and-brand
- **PRD refs:** none — marketing/UX.
- **Prerequisites:** S-06
- **Status:** done

### S-11: Account deletion

- **Outcome:** A logged-in runner can permanently delete their account from a Settings menu; the destructive action is confirmed by an emailed link, and deletion cascades to all their plans, aid stations, gear, and selections.
- **Change ID:** account-deletion
- **PRD refs:** TBD — likely a new FR (account lifecycle / right-to-erasure); resolve during planning.
- **Prerequisites:** S-06
- **Note:** DB already cascades from `auth.users` (ON DELETE CASCADE). Open unknowns: admin/service-role delete on Workers, and the email-link mechanism. Research first.
- **Status:** todo

### S-12: Excel export

- **Outcome:** Runner can export a plan (the generated segment-by-segment table) to an Excel file.
- **Change ID:** excel-export
- **PRD refs:** was §Non-Goals ("XLS / Excel export") — un-parking; PRD update needed.
- **Prerequisites:** S-02
- **Status:** todo

### S-13: Collapsible plan-builder sections

- **Outcome:** Runner can collapse / expand the Race parameters, Aid stations, and Gear sections of the plan builder to cut scrolling on long plans.
- **Change ID:** collapsible-plan-sections
- **PRD refs:** none — UX enhancement.
- **Prerequisites:** S-01
- **Status:** todo

### S-14: Race-wide gear totals

- **Outcome:** The plan-table total row shows how many of each gear item is needed for the whole race (e.g. "12× gel, 4× drink, 6× salt cap").
- **Change ID:** gear-total-summary
- **PRD refs:** none — UX enhancement.
- **Prerequisites:** S-03
- **Status:** todo

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                                    | Ready for `/10x-plan` | Notes                                   |
| ---------- | --------------------------- | -------------------------------------------------------- | --------------------- | --------------------------------------- |
| F-01       | plan-data-and-ownership     | Persist plans & aid stations with per-user RLS           | yes                   | Run `/10x-plan plan-data-and-ownership` |
| S-01       | race-setup-and-aid-stations | Race setup form + aid-station add/list/delete (autosave) | no                    | After F-01                              |
| S-02       | generate-plan-table         | Generate segment-by-segment plan table                   | no                    | North star; after S-01                  |
| S-03       | gear-profile-units          | Gear profile → unit-level plan output                    | no                    | After S-02                              |
| S-04       | plan-dashboard-view         | Dashboard list + read-only saved-plan view               | no                    | After S-02; parallel with S-03          |
| S-05       | delete-saved-plan           | Delete saved plan with confirmation                      | no                    | After S-04                              |
| S-06       | email-otp-auth              | Passwordless email OTP (code) auth + route gating        | yes                   | Replaces the password scaffold; PRD v4  |

## Open Roadmap Questions

**Pending (2026-06-19):** the **PRD is not yet reconciled** with shipped reality — GPX import (S-07) and public pages (S-10) lack FRs, the §Non-Goals entries for GPX import and XLS/Excel export are stale, and account-deletion (S-11) needs a right-to-erasure FR. Roadmap was reconciled in `version: 2`; PRD update is the next doc task.

Prior questions resolved:

1. ~~Auth method: email + password vs. passwordless.~~ **Resolved (PRD v4, 2026-06-17)** — **passwordless email OTP** (6-digit code via `signInWithOtp`/`verifyOtp`). This reverses the v3 email+password reconciliation (which had only matched the bootstrapped scaffold) and restores the original `shape-notes.md` passwordless intent, choosing an OTP code over a magic link for cross-device / email-client reliability. S-06 replaces the password scaffold.
2. ~~"Total expected finish time" as a race parameter.~~ **Resolved** — added to FR-003's parameter list, consistent with Business Logic.

## Parked

- **Full editing of saved-plan parameters** — Partially shipped: inline **aid-station** editing landed as **S-08** (US-10/FR-007). Full race-parameter editing of a saved plan is still v2.
- **Rename a saved plan (FR-010)** — Why parked: PRD demotes FR-010 to nice-to-have (v2), bundled with the full edit flow.
- **Undo for plan deletion** — Why parked: PRD FR-011 ships hard delete with confirmation; undo is v2.
- ~~**GPX import**~~ — **Shipped** as **S-07** (`gpx-import`, archived 2026-06-18); pulled forward from §Non-Goals.
- **Elevation-adjusted time model / uphill-downhill profiling** — Why parked: `shape-notes.md` §Forward (v2 technical roadmap); MVP uses Naismith's rule with a fixed k only.
- **XLS / Excel export** — **Un-parking**: now planned as **S-12** (`excel-export`). PRD §Non-Goals entry needs updating when it lands.
- **Shared / collaborative plans** — Why parked: PRD §Non-Goals — primary persona is the individual runner; collaboration is a deferred secondary-persona concern.
- **Offline mode** — Why parked: PRD §Non-Goals — auto-save + multi-device access require a backend; offline adds a third storage layer not worth it for a pre-race planning tool.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived. Do NOT pre-populate.)

- **F-01: (foundation) plans and aid stations are stored server-side and are readable/writable only by their owning runner.** — Archived 2026-06-15 → `context/archive/2026-06-03-plan-data-and-ownership/`. Lesson: —.
- **S-01: Runner can create a race plan (parameters) and add, list, and delete aid stations, with every change auto-saved.** — Archived 2026-06-15 → `context/archive/2026-06-15-race-setup-and-aid-stations/`. Lesson: —.
- **S-02: Runner can generate a correct segment-by-segment plan table — per-segment travel time, estimated clock arrival, and fluid/carb/sodium targets, with aid-station context inline.** — Archived 2026-06-16 → `context/archive/2026-06-15-generate-plan-table/`. Lesson: —.
- **S-03: Runner can optionally build a per-plan gear catalog (gels, carb drink, solid food, water carrier, salt caps); the plan table then auto-suggests whole-unit fueling per segment (carb-led, ratio-weighted, with fluid/sodium gap-fill) and lets the runner cap a product or pin an exact override per stage, showing achieved-vs-target with a signed delta. With no gear, the table stays in gram/ml/mg targets.** — Archived 2026-06-16 → `context/archive/2026-06-16-gear-profile-units/`. Lesson: —.
- **S-04: Runner can see all their saved plans on a dashboard and open one in read-only view; a runner with no plans sees an empty-state prompt to create their first plan.** — Archived 2026-06-16 → `context/archive/2026-06-16-plan-dashboard-view/`. Lesson: —.
- **S-05: Runner can permanently delete a saved plan from the dashboard after explicitly confirming in a dialog.** — Archived 2026-06-17 → `context/archive/2026-06-16-delete-saved-plan/`. Lesson: —.
- **S-06: Runner can sign up / sign in with a 6-digit one-time code emailed to them, sign out, and is redirected to the sign-in screen when reaching a gated route unauthenticated. No password is stored.** — Archived 2026-06-18 → `context/archive/2026-06-17-email-otp-auth/`. Lesson: —.
- **S-07: Runner can import a GPX route to auto-fill total distance/elevation and pre-create aid stations from its waypoints.** — Archived 2026-06-18 → `context/archive/2026-06-17-gpx-import/`. Lesson: —.
- **S-08: Runner can edit any field of an existing aid station inline, with re-sort on distance change and segment recompute.** — Archived 2026-06-18 → `context/archive/2026-06-18-edit-aid-stations/`. Lesson: —.
- **S-09: Runner sees on-hover/focus field-help on the non-obvious plan-form inputs.** — Archived 2026-06-18 → `context/archive/2026-06-18-tooltips/`. Lesson: —.
- **S-10: Visitor lands on a branded public welcome/about/contact site; sign-in routes to the dashboard; a shared nav spans public + app pages.** — Archived 2026-06-19 → `context/archive/2026-06-19-public-pages-and-brand/`. Lesson: —.

### Maintenance / fixes (post-MVP)

Bug fixes, not user-visible feature slices (see archive for detail):

- **Aid-station distance/elevation shown unrounded in the editor + view list** — Archived 2026-06-19 → `context/archive/2026-06-19-fix-aid-station-rounding/`.
- **Gear edit panel rendered under the last segment instead of the edited one** — Archived 2026-06-19 → `context/archive/2026-06-19-fix-gear-panel-position/`.

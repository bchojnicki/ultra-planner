---
project: "Ultra Planner"
version: 6
status: draft
created: 2026-05-19
updated: 2026-06-19
context_type: greenfield
product_type: web-app
target_scale:
  users: large
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Creating a race plan for an ultra marathon is a workflow problem: the task exists, every serious runner eventually does it, but it takes too long and requires too many manual steps. Estimating segment times, calculating fluid and calorie needs, accounting for electrolytes, and coordinating crew logistics all compound on each other — and small errors in one variable ripple through the whole plan.

The insight is that existing tools (spreadsheets, generic planners) treat nutrition as a total-distance problem, not a time-on-feet-per-segment problem. They also ignore aid station heterogeneity: not every checkpoint has crew access, a drop bag, or a hot meal. A runner's gear is specific — bladder capacity, gel calorie and carb density, electrolyte product — and the plan has to account for it. No generic tool does this; runners currently do it by hand, from memory, or not at all.

## User & Persona

**Primary persona: the individual ultra runner**

An athlete preparing for an ultra marathon — any distance from 50 km upward. They have a race ahead, they have the official aid station list, and they need a segment-by-segment plan before race day. They may be experienced or first-timers; what unites them is that they are building the plan themselves, for their own body and their own gear. They are not sharing it with a coach or a coordinator in the MVP — this is one person, one plan.

## Success Criteria

### Primary

- A runner completes the full four-step flow — race parameters → gear profile → aid stations → generate — and receives a correct segment-by-segment plan table showing estimated time and fluid/carb/sodium targets for each leg.

### Secondary

- Plans are retrievable: the runner can return after closing the browser and find their saved plan in read-only view. (Full editing of saved plan parameters is v2.)

### Guardrails

- Calculation accuracy is non-negotiable. A plan that produces wrong nutrition numbers is actively harmful. Any failure in the segment calculation is a regression regardless of whether the primary flow otherwise works.

## User Stories

### US-01: Runner generates a race plan

- **Given** a logged-in runner who has entered race parameters, a gear profile, and at least one aid station
- **When** they submit the form to generate the plan
- **Then** they see a segment-by-segment table with one row per leg showing estimated travel time, and the fluid, carbohydrate, and sodium quantities needed for that segment

#### Acceptance Criteria

- Every segment between consecutive aid stations appears as a separate row
- Fluid and carbohydrate quantities are derived from the runner's hourly targets and the estimated time for that segment, not from the total race distance
- A plan with zero aid stations shows an explanatory state rather than an empty or broken table

### US-02: Runner signs up with a one-time code

- **Given** an unauthenticated visitor on the sign-in screen who has not registered before
- **When** they enter their email address for the first time and request a code
- **Then** the app emails them a 6-digit one-time code and shows a code-entry screen; entering the valid code creates their account and takes them to the plan dashboard

#### Acceptance Criteria

- The form requires only an email address — no password
- Requesting a code for a new email creates the account on first successful code entry; there is no separate registration step
- After requesting a code, the app navigates to a code-entry screen; it does not show an inline message
- Neither the request nor the code-entry screen reveals whether the email address was previously registered
- An expired or incorrect code shows an error and lets the runner request a new code

### US-03: Runner signs in to an existing account

- **Given** a registered runner who is not currently logged in
- **When** they enter their email address on the sign-in screen and request a code
- **Then** the app emails a 6-digit one-time code; entering the valid code authenticates them and takes them to the plan dashboard

#### Acceptance Criteria

- The sign-in form requires only an email address — no password
- A valid code authenticates the runner and redirects to the dashboard; an expired or incorrect code shows an error on the code-entry screen and allows requesting a new code
- A runner with no saved plans sees an empty dashboard with a prompt to create their first plan
- An unauthenticated user who reaches a gated route is redirected to the sign-in screen

### US-04: Runner adds an aid station

- **Given** a logged-in runner viewing their race plan in the aid stations step
- **When** they enter cumulative distance, cumulative elevation gain, select facility checkboxes, optionally add crew notes, and confirm
- **Then** the aid station appears in the plan's aid station list in distance order, and the plan table is updated to reflect the new segment

#### Acceptance Criteria

- The form accepts: cumulative distance (number), cumulative elevation gain (number), and checkboxes for water only, food available, warm meal, drop bag available, rest area, support crew allowed
- A free-text notes field is available for crew-facing notes
- The app derives per-segment distance and elevation gain from consecutive cumulative entries — the runner never enters segment-level values directly
- After adding, the station appears sorted by cumulative distance regardless of entry order
- The plan table reflects the new segment without requiring the runner to re-trigger generation

### US-05: Runner deletes an aid station

- **Given** a logged-in runner viewing their plan with at least one aid station
- **When** they delete an aid station
- **Then** the station is removed from the list and the plan table updates to reflect the recalculated segments on either side

#### Acceptance Criteria

- Each aid station in the list has a visible delete action
- Deleting a station merges the segments on either side; the app recalculates their combined distance and elevation gain
- No confirmation dialog is required for aid station deletion
- The plan table updates immediately after deletion

### US-06: Runner configures a gear profile and tunes per-segment fueling

- **Given** a logged-in runner editing a plan, with a Gear section between race parameters and aid stations
- **When** they optionally build a gear catalog (gels, carbohydrate drink, solid food, water carrier, salt caps) and, per segment, accept the auto-suggested unit quantities or adjust them
- **Then** the gear is saved; the generated plan table shows, per segment, the whole-unit quantities to carry plus how those units compare to the gram/ml/mg targets

#### Acceptance Criteria

- The Gear section is optional: the runner can skip it and the plan table shows gram/ml/mg targets only
- With gear defined, the plan table shows the per-segment fueling in whole units (a dedicated "Fuel" column lists each item once, e.g. "1× drink, 9× gel, 2× bar"), while the Fluid/Carbs/Sodium columns show achieved-vs-target numbers with a signed delta
- Auto-suggestion is carb-led: the carbohydrate target is split across the runner's carb sources by a per-product carb-ratio weight; the resulting drink units cover fluid (a water carrier fills any gap) and the resulting gel/drink/food units cover sodium (salt caps fill any gap)
- Per segment, the runner can cap a product's units (a limit, which redistributes the remainder across the other carb sources by ratio) and/or pin an exact unit count (a direct override that wins over the suggestion)
- Per-segment limits and overrides are stored sparsely (only deviations) and auto-saved; quantities round to the nearest whole unit
- Gear item kinds and their inputs: gel (carbs + optional sodium per unit), carbohydrate drink (carbs + fluid + optional sodium per serving), solid food (carbs + optional sodium per unit), water carrier (capacity per unit), salt cap (sodium per unit); each carb source carries a carb-ratio weight
- Each gear item is individually optional — the runner may enter only gels without a drink or carrier
- Adding or deleting an aid station changes the segment layout; per-segment selections that no longer map are cleared and the affected segments are re-suggested

### US-07: Runner views a previously saved plan

- **Given** a logged-in runner on the plan dashboard with at least one saved plan
- **When** they select a plan from the list
- **Then** they see the plan in read-only view showing all entered race parameters, aid stations, gear profile, and the generated plan table

#### Acceptance Criteria

- The dashboard shows all of the runner's saved plans, each showing at minimum the plan name and last-updated date
- Selecting a plan opens it in read-only view — parameters, aid stations, and gear profile cannot be edited from this view (full editing is v2)
- The plan table is displayed as it was when last generated; the runner does not need to re-trigger generation
- A runner with no saved plans sees an empty-state dashboard with a prompt to create their first plan

### US-08: Runner's plan is auto-saved

- **Given** a logged-in runner who is entering race parameters, configuring their gear profile, or adding aid stations
- **When** they make any change to their plan
- **Then** the change is persisted automatically — no explicit save action is required, and returning to the app after closing the browser shows all entered data intact

#### Acceptance Criteria

- Changes are saved without the runner needing to click a save button
- If the runner closes the browser and returns, all entered data is present
- Auto-save is silent — the runner receives no explicit save confirmation and never sees an "unsaved changes" warning

### US-09: Runner deletes a saved plan

- **Given** a logged-in runner on the plan dashboard with at least one saved plan
- **When** they initiate plan deletion and confirm in the confirmation dialog
- **Then** the plan is permanently removed from their account and no longer appears on the dashboard

#### Acceptance Criteria

- A delete action is available for each plan on the dashboard
- A confirmation dialog appears before any deletion; the runner must explicitly confirm
- Confirmed deletion is permanent and immediate — no undo (undo is v2)
- If the runner dismisses the dialog without confirming, the plan is not deleted
- The dashboard updates immediately after a confirmed deletion

### US-10: Runner edits an aid station

- **Given** a logged-in runner viewing their race plan with at least one aid station
- **When** they open an existing aid station, change any of its fields (cumulative distance, cumulative elevation gain, cumulative elevation loss, time spent, facility checkboxes, crew notes), and confirm
- **Then** the station is updated in place, re-sorted by cumulative distance if it changed, and the plan table reflects the recalculated segments

#### Acceptance Criteria

- Each aid station in the list has a visible edit action that opens its current values for editing
- Every field editable at creation is editable here, including cumulative elevation loss (added with GPX import)
- This is the primary way to enrich the bare aid stations created by a GPX waypoint import — those arrive with distance/elevation/name only, no facilities, time, or crew notes
- On save the station re-sorts by cumulative distance if the distance changed, and the plan table updates without the runner re-triggering generation
- Editing is auto-saved consistent with the rest of the plan; no explicit save action beyond confirming the edit

### US-11: Runner imports a route from GPX

- **Given** a logged-in runner editing a plan
- **When** they upload a GPX route file
- **Then** the app fills in total distance and elevation gain/loss from the track and pre-creates an aid station for each waypoint, which the runner can then enrich via edit (US-10)

#### Acceptance Criteria

- Total distance and total elevation gain/loss are computed from the track points and saved in the background as editable race details
- Every waypoint in the file becomes an aid station with its cumulative distance/elevation; a file with no waypoints leaves manual entry as the path
- Imported aid stations carry distance/elevation/name only — facilities, time, and crew notes are added afterward via aid-station edit (US-10)

## Functional Requirements

### Authentication

- FR-001: Runner can sign up with just an email address — the app emails a 6-digit one-time code that, when entered, creates the account. No password is set or stored. Priority: must-have

  > Socrates: Counter-argument considered: "account creation adds friction for a one-time use tool." Resolution: kept — plans must be tied to an identity for cross-device access (Secondary success criterion). Auth is passwordless email OTP (Supabase `signInWithOtp` → `verifyOtp`), realigning with the original shape-notes passwordless intent. A 6-digit code is used rather than a magic link for cross-device / email-client reliability (v4, 2026-06-17 — reverses the v3 email+password reconciliation, which had only matched the bootstrapped scaffold).

- FR-002: Runner can sign in to an existing account with the same email + one-time-code flow. Priority: must-have
  > Socrates: Counter-argument considered: "passwordless means a code round-trip on every login." Resolution: accepted — no password is stored or managed, which removes the password-reset flow entirely. Sign-up and sign-in share one flow: `signInWithOtp` creates the user on first use and authenticates returning users thereafter.

### Race Setup

- FR-003: Runner can create a race plan with name, total distance, total elevation gain and loss, start time, total expected finish time, and hourly targets for fluid intake, carbohydrate intake, and sodium intake. Priority: must-have

  > Socrates: Counter-argument considered: "flat-pace MVP would skip elevation complexity." Resolution: kept — elevation is required from day one; plans without elevation correction would give misleading time estimates in an ultra context.
  > Note: total expected finish time is a required input — Business Logic distributes it across segments (segment hours = total_expected_hours × segment weight share). Added to the parameter list for consistency with Business Logic.

- FR-004: Runner can optionally build a per-plan gear catalog of five item kinds (gel, carbohydrate drink, solid food, water carrier, salt cap), each with its per-unit nutrition content and — for carb sources — a carb-ratio weight. With no gear, the plan table shows gram/ml/mg targets only; with gear, it auto-suggests whole-unit fueling per segment (carb-led: the carb target is split across carb sources by ratio, drink units + a water carrier cover fluid, gel/drink/food units + salt caps cover sodium), shows achieved-vs-target with a signed delta, and lets the runner cap a product per stage (with redistribution) or pin an exact per-stage override. Priority: must-have
  > Socrates: Counter-argument considered: "gear could use defaults, making this optional." Resolution: gear profile is optional but unlocks unit-level output.
  > Scope evolution (2026-06-16, change `gear-profile-units`): the original one-way gram→unit transform was expanded to a **hybrid** model — auto-suggestion plus per-segment limits and direct overrides — and sodium was added as a third unit-mapped target (salt caps). Sources are a per-plan catalog of five kinds rather than a fixed bladder/gel/drink trio. The underlying gram/ml/mg calc (Business Logic) is unchanged; gear only decorates and compares against it.

### Aid Stations

- FR-005: Runner can add an aid station to their plan specifying cumulative distance from the race start, cumulative elevation gain and loss from the start, planned time spent at the station, plus checkboxes (water only, food available, warm meal, drop bag available, rest area, support crew allowed) and free-text notes for the support crew. The app derives segment distance and segment elevation gain internally. Priority: must-have

  > Socrates: Counter-argument considered: "cumulative vs. leg distance — which does the runner enter?" Resolution: runner enters cumulative distance from start; the app subtracts consecutive stations to get leg distance for the calculation. More natural for reading an official race roadbook.

- FR-006: Runner can delete a previously added aid station. Priority: must-have

  > Socrates: Counter-argument considered: "without edit, delete-then-re-add is the only error correction path." Resolution: kept — delete is the must-have minimum. Inline edit is a desirable companion but not blocking for MVP.

- FR-012: Runner can edit any field of a previously added aid station (cumulative distance, cumulative elevation gain, cumulative elevation loss, time spent, facility checkboxes, crew notes). Edits update the station in place and re-derive the affected segments. Priority: should-have
  > Socrates: Reactivates the inline-edit companion deferred at FR-006 ("desirable companion but not blocking for MVP"). Motivated by GPX import (change `gpx-import`, 2026-06-18): waypoint import creates aid stations with only distance/elevation/name, so edit becomes the path to add facilities, rest time, and crew notes to imported stations rather than delete-and-re-add.
  > Renumber (v6): was mistakenly labelled FR-007 in v5, colliding with the plan-generation FR-007 below; renumbered to FR-012.

### GPX Import

- FR-013: Runner can upload a GPX route file to auto-fill total distance and total elevation gain/loss, and to pre-create an aid station from each waypoint in the file (cumulative distance/elevation from the start). When the file has no waypoints, manual aid-station entry remains the path. Computed totals save in the background and remain editable race details. Priority: shipped (pulled forward from v2; change `gpx-import`, 2026-06-18)
  > Note: reverses the original §Non-Goal "No GPX import". Cumulative elevation **loss** as a stored field arrived with this feature; aid stations created from waypoints are bare (distance/elevation/name only) and enriched via FR-012/US-10.

### Plan Generation

- FR-007: Runner can generate a plan table showing, for each segment between consecutive aid stations: estimated travel time, estimated clock arrival time at the next station, fluid/carbohydrate/sodium quantities needed for that leg, and the aid station context inline (drop bag availability, support crew allowed, food type). Priority: must-have
  > Socrates: Counter-argument considered: "the time estimation algorithm must be precisely specified or two implementations can produce different numbers." Resolution: kept — the requirement to produce the table is non-negotiable. The algorithm specification belongs in Business Logic, not in the FR.

### Persistence

- FR-008: Runner's plan is auto-saved as they edit — no explicit save action required. Priority: must-have

  > Socrates: Counter-argument considered: "explicit save risks data loss if tab is closed before clicking." Resolution: changed — auto-save adopted. Simpler UX, no data-loss risk. FR updated.

- FR-009: Runner can load and view a previously saved plan. Priority: must-have

  > Socrates: Counter-argument considered: "read-only load might be sufficient for MVP; editing could ship in v2." Resolution: changed — MVP scope is load + view only. Editing saved plan parameters moves to v2. FR updated.

- FR-010: Runner can rename a saved plan. Priority: nice-to-have (v2)

  > Socrates: Counter-argument considered: "rename is part of the edit flow; if editing is v2, rename is v2." Resolution: moved to v2 alongside full edit. Demoted from must-have to nice-to-have.

- FR-011: Runner can delete a saved plan (with confirmation dialog before permanent removal). Priority: must-have
  > Socrates: Counter-argument considered: "a misclick permanently destroys work." Resolution: kept — hard delete with confirmation dialog is the standard pattern. Confirmation handles accidental-delete risk. Undo is v2.

### Account Management

- FR-014: Runner can permanently delete their account from a Settings menu. The destructive action is re-authenticated with a fresh one-time code, then confirmed via a single-use emailed link; on confirmation it removes the account and all associated data (plans, aid stations, gear, per-segment selections). Priority: shipped (change `account-deletion`)
  > Note: data removal relies on the existing DB cascade from `auth.users` (ON DELETE CASCADE from plans → aid_stations / gear_items / gear_segment_selections); the auth-user row is hard-deleted via a service-role admin client. The emailed link is a single-use, 30-minute, hashed-at-rest token (table `account_deletion_tokens`) delivered through Resend; a cascade-surviving audit row (`account_deletion_events`, no FK to `auth.users`) records each deletion.

### Public Site

- FR-015: A logged-out visitor can reach a branded public welcome page and read public About and Contact pages without signing in; signing in routes to the dashboard. Priority: shipped (change `public-pages-and-brand`)
  > Note: marketing/presentation surface, not a runner capability — included for parity with roadmap slice S-10. Contact uses a mailto affordance (no backend).

## Non-Functional Requirements

- A runner perceives plan generation as instant: the plan table appears within 1 second of triggering generation for any race with up to 50 aid stations.
- No runner's race plan data is transmitted to any third party or made accessible outside the runner's account without the runner's explicit action.
- A runner can permanently erase their account and all associated data, with no residual plan data retained after deletion. (Shipped — see FR-014.)
- The application is fully usable on the two most recent major versions of Chrome, Firefox, Safari, and Edge on both desktop and mobile form factors.

## Business Logic

The app distributes the runner's expected finish time across segments proportionally, weighted by each segment's distance and elevation gain, then derives per-segment fluid, carbohydrate, and sodium requirements from those time estimates.

The rule consumes four user-facing inputs: the total expected finish time (entered as a race parameter), per-segment distance (derived internally from consecutive cumulative-distance entries at aid stations), per-segment elevation gain (derived internally from consecutive cumulative-elevation entries at aid stations), and hourly physiological targets for fluid, carbohydrates, and sodium. No GPS trace, no real-time data, and no performance model beyond the runner's own expected time are used in the MVP.

The output is a per-segment time allocation: segment hours = total_expected_hours × (segment_weight / sum_of_all_weights), where segment_weight = segment_distance + k × segment_elevation_gain, and k = 0.01 km/m (Naismith's rule default: 10 m of ascent is treated as equivalent in time cost to 0.1 km of flat distance, consistent with an ultra trail pace of approximately 10 min/km on flat terrain). From each segment's allocated hours, fluid/carb/sodium quantities follow directly from the hourly targets. If a gear profile was entered, the output additionally shows unit-level equivalents (e.g. "3 gels + 400ml carb drink").

The runner encounters the rule by entering all parameters and aid stations, then triggering plan generation. The plan table appears immediately, one row per segment, and does not require any further interaction.

## Access Control

Multi-user web application. Each runner signs up and signs in with a passwordless email one-time code (6-digit), managed by Supabase Auth — no password is stored or managed. Plans are stored server-side and tied to the authenticated user; a runner can access their plans from any device once logged in.

User model is flat: all registered users are runners with identical capabilities. No admin role exists in the MVP. An unauthenticated user who reaches a gated route is redirected to the login screen.

## Non-Goals

- ~~**No GPX import**~~ — **Shipped** (FR-013 / US-11, change `gpx-import`, 2026-06-18); pulled forward from v2. GPX route loading and automatic elevation extraction are now supported; historical-run pace profiling remains out of scope. The original MVP-complexity rationale no longer applies.
- ~~**XLS / Excel export**~~ — **Shipped** (roadmap S-12, change `excel-export`, 2026-06-19); was a Non-Goal. The read-only saved-plan view now offers an "Export to Excel" button that downloads a single-sheet `.xlsx` (race parameters + segment table + gear/fuel), generated client-side. The original "the app is the plan; format conversion adds surface area" rationale no longer applies.
- **No shared or collaborative plans**: plans are private to the runner who created them. No sharing link, no coach/crew portal, no team workspace. Rationale: primary persona is the individual runner; collaboration is a secondary persona concern explicitly deferred.
- **No offline mode**: an internet connection is required. The app provides no service worker, no local-first storage, and no offline fallback. Rationale: the auto-save and multi-device access goals require a backend; offline adds a third storage layer that outweighs the benefit for a planning tool used at home before race day.

## Open Questions

- **Reconciled to v6 (2026-06-19)** against shipped reality and `roadmap.md` v2: added GPX import (FR-013 / US-11), the public site (FR-015), and account deletion as planned (FR-014 + erasure NFR); split the duplicate FR-007 (aid-station edit is now FR-012; plan generation keeps FR-007); updated §Non-Goals for GPX (shipped) and Excel (planned then; **shipped 2026-06-19**, change `excel-export`). Roadmap slices S-09 (field-help tooltips), S-13 (collapsible plan sections), and S-14 (race-wide gear totals) are intentionally **UX-only with no FR** — they refine presentation, not product scope.
- **Account deletion (FR-014) — resolved & shipped (2026-06-19, change `account-deletion`):** the `auth.users` row is hard-deleted via a service-role admin client (`SUPABASE_SERVICE_ROLE_KEY`); the email-confirmation link is a custom single-use, 30-minute, hashed token table delivered through Resend (`RESEND_API_KEY` / `RESEND_FROM_EMAIL`), gated behind a fresh OTP re-auth. Data removal rides the existing `ON DELETE CASCADE`; a cascade-surviving audit row is written.

---
project: "Ultra Planner"
version: 2
status: draft
created: 2026-05-19
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

### US-02: Runner registers an account

- **Given** an unauthenticated visitor on the sign-up screen
- **When** they enter their email address and a password and submit for the first time
- **Then** they see a "check your email" confirmation screen; clicking the confirmation link in the email activates their account, after which they can sign in and reach the plan dashboard

#### Acceptance Criteria

- The form requires an email address and a password
- After submission, the app navigates to a confirmation screen; it does not show an inline message
- Clicking the confirmation link in the email activates the runner's account
- The confirmation screen does not reveal whether the email address was previously registered

### US-03: Runner logs in to an existing account

- **Given** a registered runner who is not currently logged in
- **When** they enter their email address and password and submit on the sign-in screen
- **Then** they are authenticated and taken to the plan dashboard

#### Acceptance Criteria

- The sign-in form requires an email address and a password
- Successful authentication redirects the runner to the dashboard; invalid credentials show an error on the sign-in screen
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

### US-06: Runner configures a gear profile

- **Given** a logged-in runner who has completed the race parameters step (step 1) and is now on the gear profile step (step 2)
- **When** they optionally enter their gear details (bladder or soft flask, gels, carbohydrate drink) and proceed
- **Then** their gear profile is saved; the generated plan table will show unit-level quantities for each segment instead of gram/ml targets

#### Acceptance Criteria

- The gear profile step is optional: the runner can skip it and proceed to step 3 (aid stations) without entering any gear
- If skipped, the generated plan table shows gram/ml targets for fluid and carbohydrates
- If entered, the generated plan table shows unit-level equivalents (e.g. "4 gels + 500ml drink") for each segment
- Gear inputs: bladder or soft flask (count and capacity per unit), gel (size and carbohydrate content per unit), carbohydrate drink (container capacity and carbohydrates per serving)
- Each gear item is individually optional — the runner may enter only gels without entering a bladder

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

## Functional Requirements

### Authentication

- FR-001: Runner can register with an email address and password. Priority: must-have

  > Socrates: Counter-argument considered: "account creation adds friction for a one-time use tool." Resolution: kept — plans must be tied to an identity for cross-device access (Secondary success criterion). Registration stands. Auth method is email + password, matching the bootstrapped Supabase scaffold.

- FR-002: Runner can log in with their email address and password. Priority: must-have
  > Socrates: Counter-argument considered: "email + password means building a password-reset flow." Resolution: accepted — email + password matches the existing Supabase scaffold. A self-service password-reset flow is out of MVP scope and deferred to v2.

### Race Setup

- FR-003: Runner can create a race plan with name, total distance, total elevation gain and loss, start time, total expected finish time, and hourly targets for fluid intake, carbohydrate intake, and sodium intake. Priority: must-have

  > Socrates: Counter-argument considered: "flat-pace MVP would skip elevation complexity." Resolution: kept — elevation is required from day one; plans without elevation correction would give misleading time estimates in an ultra context.
  > Note: total expected finish time is a required input — Business Logic distributes it across segments (segment hours = total_expected_hours × segment weight share). Added to the parameter list for consistency with Business Logic.

- FR-004: Runner can optionally configure a gear profile (bladder or soft flask with count and capacity; gels with size and carbohydrate content per unit; carbohydrate drink with container capacity and carbs per serving). Without a gear profile, the plan table shows gram/ml targets only; with a gear profile, it shows unit-level output (e.g. "4 gels + 500ml drink"). Priority: must-have
  > Socrates: Counter-argument considered: "gear could use defaults, making this optional." Resolution: gear profile is now optional but unlocks unit-level output. Two modes — simple (gram/ml) and detailed (gear units). FR updated.

### Aid Stations

- FR-005: Runner can add an aid station to their plan specifying cumulative distance from the race start, cumulative elevation gain from the start, planned time spent at the station, plus checkboxes (water only, food available, warm meal, drop bag available, rest area, support crew allowed) and free-text notes for the support crew. The app derives segment distance and segment elevation gain internally. Priority: must-have

  > Socrates: Counter-argument considered: "cumulative vs. leg distance — which does the runner enter?" Resolution: runner enters cumulative distance from start; the app subtracts consecutive stations to get leg distance for the calculation. More natural for reading an official race roadbook.

- FR-006: Runner can delete a previously added aid station. Priority: must-have
  > Socrates: Counter-argument considered: "without edit, delete-then-re-add is the only error correction path." Resolution: kept — delete is the must-have minimum. Inline edit is a desirable companion but not blocking for MVP.

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

## Non-Functional Requirements

- A runner perceives plan generation as instant: the plan table appears within 1 second of triggering generation for any race with up to 50 aid stations.
- No runner's race plan data is transmitted to any third party or made accessible outside the runner's account without the runner's explicit action.
- The application is fully usable on the two most recent major versions of Chrome, Firefox, Safari, and Edge on both desktop and mobile form factors.

## Business Logic

The app distributes the runner's expected finish time across segments proportionally, weighted by each segment's distance and elevation gain, then derives per-segment fluid, carbohydrate, and sodium requirements from those time estimates.

The rule consumes four user-facing inputs: the total expected finish time (entered as a race parameter), per-segment distance (derived internally from consecutive cumulative-distance entries at aid stations), per-segment elevation gain (derived internally from consecutive cumulative-elevation entries at aid stations), and hourly physiological targets for fluid, carbohydrates, and sodium. No GPS trace, no real-time data, and no performance model beyond the runner's own expected time are used in the MVP.

The output is a per-segment time allocation: segment hours = total_expected_hours × (segment_weight / sum_of_all_weights), where segment_weight = segment_distance + k × segment_elevation_gain, and k = 0.01 km/m (Naismith's rule default: 10 m of ascent is treated as equivalent in time cost to 0.1 km of flat distance, consistent with an ultra trail pace of approximately 10 min/km on flat terrain). From each segment's allocated hours, fluid/carb/sodium quantities follow directly from the hourly targets. If a gear profile was entered, the output additionally shows unit-level equivalents (e.g. "3 gels + 400ml carb drink").

The runner encounters the rule by entering all parameters and aid stations, then triggering plan generation. The plan table appears immediately, one row per segment, and does not require any further interaction.

## Access Control

Multi-user web application. Each runner registers and logs in with an email address and password, managed by Supabase Auth. Plans are stored server-side and tied to the authenticated user; a runner can access their plans from any device once logged in.

User model is flat: all registered users are runners with identical capabilities. No admin role exists in the MVP. An unauthenticated user who reaches a gated route is redirected to the login screen.

## Non-Goals

- **No GPX import**: all race data (distance, elevation) is entered manually by the runner. GPX-based route loading, automatic elevation extraction, and historical-run pace profiling are explicitly v2+. Rationale: GPX parsing and profile analysis are the primary drivers of MVP complexity; deferring them keeps the v1 build achievable in 3 weeks.
- **No XLS / Excel export**: the plan table is viewable and usable only within the web app. No spreadsheet download. Rationale: the app is the plan; format conversion adds surface area without improving planning quality.
- **No shared or collaborative plans**: plans are private to the runner who created them. No sharing link, no coach/crew portal, no team workspace. Rationale: primary persona is the individual runner; collaboration is a secondary persona concern explicitly deferred.
- **No offline mode**: an internet connection is required. The app provides no service worker, no local-first storage, and no offline fallback. Rationale: the auto-save and multi-device access goals require a backend; offline adds a third storage layer that outweighs the benefit for a planning tool used at home before race day.

## Open Questions

No open questions.

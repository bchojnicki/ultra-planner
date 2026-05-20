---
project: "Ultra Planner"
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
created: 2026-05-19
updated: 2026-05-19
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "workflow friction — the task exists but takes too long and too many manual steps"
    - topic: "insight"
      decision: "segment-specific nutrition math; aid station variability (drop bags, crew, hot food differ); hydration product specifics (bladder, gel carb content, electrolyte mix)"
    - topic: "persona scope"
      decision: "individual ultra runner — one athlete building their own plan"
    - topic: "auth method"
      decision: "magic link / passwordless; no password storage; plans stored server-side"
    - topic: "role model"
      decision: "flat — all logged-in users are runners with identical capabilities; no admin role in MVP"
  frs_drafted: 11
  quality_check_status: accepted
---

## Vision & Problem Statement

Creating a race plan for an ultra marathon is a workflow problem: the task exists, every serious runner eventually does it, but it takes too long and requires too many manual steps. Estimating segment times, calculating fluid and calorie needs, accounting for electrolytes, and coordinating crew logistics all compound on each other — and small errors in one variable ripple through the whole plan.

The insight is that existing tools (spreadsheets, generic planners) treat nutrition as a total-distance problem, not a time-on-feet-per-segment problem. They also ignore aid station heterogeneity: not every checkpoint has crew access, a drop bag, or a hot meal. A runner's gear is specific — bladder capacity, gel calorie and carb density, electrolyte product — and the plan has to account for it. No generic tool does this; runners currently do it by hand, from memory, or not at all.

## User & Persona

**Primary persona: the individual ultra runner**

An athlete preparing for an ultra marathon — any distance from 50 km upward. They have a race ahead, they have the official aid station list, and they need a segment-by-segment plan before race day. They may be experienced or first-timers; what unites them is that they are building the plan themselves, for their own body and their own gear. They are not sharing it with a coach or a coordinator in the MVP — this is one person, one plan.

## Access Control

Multi-user web application. Each runner registers and logs in via a passwordless magic link sent to their email — no password is stored or managed. Plans are stored server-side and tied to the authenticated user; a runner can access their plans from any device once logged in.

User model is flat: all registered users are runners with identical capabilities. No admin role exists in the MVP. An unauthenticated user who reaches a gated route is redirected to the login screen.

## Success Criteria

### Primary

- A runner completes the full four-step flow — race parameters → gear profile → aid stations → generate — and receives a correct segment-by-segment plan table showing estimated time and fluid/carb/sodium targets for each leg.

### Secondary

- Plans are retrievable: the runner can return after closing the browser and find their saved plan in read-only view. (Full editing of saved plan parameters is v2.)

### Guardrails

- Calculation accuracy is non-negotiable. A plan that produces wrong nutrition numbers is actively harmful. Any failure in the segment calculation is a regression regardless of whether the primary flow otherwise works.

_Timeline: 3 weeks of after-hours work. User assessed this as achievable._

## Functional Requirements

### Authentication

- FR-001: Runner can register with email (magic link / passwordless — no password required). Priority: must-have

  > Socrates: Counter-argument considered: "account creation adds friction for a one-time use tool." Resolution: kept — plans must be tied to an identity for cross-device access (Secondary success criterion). Registration stands.

- FR-002: Runner can log in via a passwordless magic link sent to their email. Priority: must-have
  > Socrates: Counter-argument considered: "email + password means building a reset flow." Resolution: changed — auth is now magic link / passwordless. No password storage, no reset flow required. FR updated.

### Race Setup

- FR-003: Runner can create a race plan with name, total distance, total elevation gain and loss, start time, and hourly targets for fluid intake, carbohydrate intake, and sodium intake. Priority: must-have

  > Socrates: Counter-argument considered: "flat-pace MVP would skip elevation complexity." Resolution: kept — elevation is required from day one; plans without elevation correction would give misleading time estimates in an ultra context.

- FR-004: Runner can optionally configure a gear profile (bladder or soft flask with count and capacity; gels with size and carbohydrate content per unit; carbohydrate drink with container capacity and carbs per serving). Without a gear profile, the plan table shows gram/ml targets only; with a gear profile, it shows unit-level output (e.g. "4 gels + 500ml drink"). Priority: must-have
  > Socrates: Counter-argument considered: "gear could use defaults, making this optional." Resolution: gear profile is now optional but unlocks unit-level output. Two modes — simple (gram/ml) and detailed (gear units). FR updated.

### Aid Stations

- FR-005: Runner can add an aid station to their plan specifying cumulative distance from the race start, cumulative elevation gain from the start, plus checkboxes (water only, food available, warm meal, drop bag available, rest area, support crew allowed) and free-text notes for the support crew. The app derives segment distance and segment elevation gain internally. Priority: must-have

  > Socrates: Counter-argument considered: "cumulative vs. leg distance — which does the runner enter?" Resolution: runner enters cumulative distance from start; the app subtracts consecutive stations to get leg distance for the calculation. More natural for reading an official race roadbook.

- FR-006: Runner can delete a previously added aid station. Priority: must-have
  > Socrates: Counter-argument considered: "without edit, delete-then-re-add is the only error correction path." Resolution: kept — delete is the must-have minimum. Inline edit is a desirable companion but not blocking for MVP.

### Plan Generation

- FR-007: Runner can generate a plan table showing, for each segment between consecutive aid stations: estimated travel time, estimated clock arrival time at the next station, fluid/carbohydrate/sodium quantities needed for that leg, and the aid station context inline (drop bag availability, support crew allowed, food type). Priority: must-have
  > Socrates: Counter-argument considered: "the time estimation algorithm must be precisely specified or two implementations can produce different numbers." Resolution: kept — the requirement to produce the table is non-negotiable. The algorithm specification belongs in Business Logic (Phase 5), not in the FR.

### Persistence

- FR-008: Runner's plan is auto-saved as they edit — no explicit save action required. Priority: must-have

  > Socrates: Counter-argument considered: "explicit save risks data loss if tab is closed before clicking." Resolution: changed — auto-save adopted. Simpler UX, no data-loss risk. FR updated.

- FR-009: Runner can load and view a previously saved plan. Priority: must-have

  > Socrates: Counter-argument considered: "read-only load might be sufficient for MVP; editing could ship in v2." Resolution: changed — MVP scope is load + view only. Editing saved plan parameters moves to v2. FR updated.

- FR-010: Runner can rename a saved plan. Priority: nice-to-have (v2)

  > Socrates: Counter-argument considered: "rename is part of the edit flow; if editing is v2, rename is v2." Resolution: moved to v2 alongside full edit. Demoted from must-have to nice-to-have.

- FR-011: Runner can delete a saved plan (with confirmation dialog before permanent removal). Priority: must-have
  > Socrates: Counter-argument considered: "a misclick permanently destroys work." Resolution: kept — hard delete with confirmation dialog is the standard pattern. Confirmation handles accidental-delete risk. Undo is v2.

## Business Logic

The app distributes the runner's expected finish time across segments proportionally, weighted by each segment's distance and elevation gain, then derives per-segment fluid, carbohydrate, and sodium requirements from those time estimates.

The rule consumes four user-facing inputs: the total expected finish time (entered as a race parameter), per-segment distance (derived internally from consecutive cumulative-distance entries at aid stations), per-segment elevation gain (derived internally from consecutive cumulative-elevation entries at aid stations), and hourly physiological targets for fluid, carbohydrates, and sodium. No GPS trace, no real-time data, and no performance model beyond the runner's own expected time are used in the MVP.

The output is a per-segment time allocation: segment hours = total_expected_hours × (segment_weight / sum_of_all_weights), where segment_weight = segment_distance + k × segment_elevation_gain and k = 0.01 km/m (Naismith's rule default: 10 m of ascent is treated as equivalent in time cost to 0.1 km of flat distance, consistent with an ultra trail pace of approximately 10 min/km on flat terrain). From each segment's allocated hours, fluid/carb/sodium quantities follow directly from the hourly targets. If a gear profile was entered, the output additionally shows unit-level equivalents (e.g. "3 gels + 400ml carb drink").

The runner encounters the rule by entering all parameters and aid stations, then triggering plan generation. The plan table appears immediately, one row per segment, and does not require any further interaction.

## Non-Functional Requirements

- A runner perceives plan generation as instant: the plan table appears within 1 second of triggering generation for any race with up to 50 aid stations.
- No runner's race plan data is transmitted to any third party or made accessible outside the runner's account without the runner's explicit action.
- The application is fully usable on the two most recent major versions of Chrome, Firefox, Safari, and Edge on both desktop and mobile form factors.

## Non-Goals

- **No GPX import**: all race data (distance, elevation) is entered manually by the runner. GPX-based route loading, automatic elevation extraction, and historical-run pace profiling are explicitly v2+. Rationale: GPX parsing and profile analysis are the primary drivers of MVP complexity; deferring them keeps the v1 build achievable in 3 weeks.
- **No XLS / Excel export**: the plan table is viewable and usable only within the web app. No spreadsheet download. Rationale: the app is the plan; format conversion adds surface area without improving planning quality.
- **No shared or collaborative plans**: plans are private to the runner who created them. No sharing link, no coach/crew portal, no team workspace. Rationale: primary persona is the individual runner; collaboration is a secondary persona concern explicitly deferred.
- **No offline mode**: an internet connection is required. The app provides no service worker, no local-first storage, and no offline fallback. Rationale: the auto-save and multi-device access goals require a backend; offline adds a third storage layer that outweighs the benefit for a planning tool used at home before race day.

## Open Questions

## Forward: v2 technical roadmap

User indicated the following capabilities are planned for v2 (not in MVP scope):

- **GPX-based route import**: load a GPX file to automatically populate distance and elevation at each aid station, replacing manual entry.
- **Elevation-adjusted time model**: more sophisticated pace calculation that accounts for uphill/downhill performance differences, either provided by the runner as parameters or derived from historical GPX files of similar completed races.
- **Uphill/downhill performance profiling**: runner uploads past race GPX files; the app infers their personal speed ratios for ascent vs. descent and applies them to the time distribution model.

## User Stories

### US-01: Runner generates a race plan

- **Given** a logged-in runner who has entered race parameters, a gear profile, and at least one aid station
- **When** they submit the form to generate the plan
- **Then** they see a segment-by-segment table with one row per leg showing estimated travel time, and the fluid, carbohydrate, and sodium quantities needed for that segment

#### Acceptance Criteria

- Every segment between consecutive aid stations appears as a separate row
- Fluid and carbohydrate quantities are derived from the runner's hourly targets and the estimated time for that segment, not from the total race distance
- A plan with zero aid stations shows an explanatory state rather than an empty or broken table

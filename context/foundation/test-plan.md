# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-02 (Phase 3 complete; §2 Risk #3/#4 corrected per research, §6.5 filled, TOCTOU defect deferred)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression. This project already has a meaningful suite — every test
   the rollout adds must close a _gap_, not duplicate existing coverage.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the ground
   truth.

A fourth rule is specific to a project that already has tests: **coverage
is not protection.** A green test that lifted its expected value from the
implementation under test (the oracle problem) green-lights current
behavior, including current bugs. Every gap this rollout closes must derive
its expected value from an _independent_ oracle — the PRD's Business Logic,
a hand-computed fixture, or the interview — not from the code being tested.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (excluding
`node_modules`, `dist`, `.astro`, docs, archive).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Impact | Likelihood | Source (evidence — not anchor)                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Plan generation mishandles a degenerate aid-station set — zero stations, duplicate cumulative distances, a station beyond the total, non-monotonic cumulative elevation, or out-of-order entry — or a malformed param (invalid start time, rest over budget), producing silently wrong numbers or a broken table instead of the explanatory state the PRD requires. (Reframed 2026-06-22 per Phase 1 research: "distances decrease → negative segment / crash" is not a real failure mode — stations are an unordered set the calc sorts, and Zod rejects negatives; the genuine gaps are the degenerate-set and explanatory-state cases above.) | High   | High       | interview Q4; PRD US-01 AC (zero-station explanatory state); PRD Business Logic (segment-weight derivation)                          |
| 2   | GPX elevation extraction is wrong at the source, so total distance/elevation **and every downstream segment time and nutrition number** inherit the error silently                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | High   | Medium     | interview Q1; PRD FR-013 / Business Logic; hot-spot dir `src/lib` (5 commits/30d)                                                    |
| 3   | The account-deletion confirmation token can be replayed, used after expiry, or used to delete the wrong account; the emailed link is not truly single-use, or the fresh-OTP re-auth gate is bypassable                                                                                                                                                                                                                                                                                                                                                                                                                                           | High   | Medium     | interview Q3; PRD FR-014; hot-spot dir `src/pages/api/account/deletion` (5 commits/30d)                                              |
| 4   | A logged-in runner reaches or mutates **another** runner's plan, aid station, or gear via a route that checks "authenticated" but not "owner" — especially routes using the service-role admin client that bypass row-level security (abuse / IDOR)                                                                                                                                                                                                                                                                                                                                                                                              | High   | Medium     | PRD Access Control + privacy NFR; abuse/security lens; hot-spot dirs `src/lib` (`supabaseAdmin`), `src/lib/services` (3 commits/30d) |
| 5   | Segment recompute after adding, editing, or deleting an aid station is wrong — failing to merge adjacent segments on delete, to re-sort on a distance change, to re-derive per-segment distance/elevation, or to clear stale per-segment gear selections that no longer map                                                                                                                                                                                                                                                                                                                                                                      | High   | Medium     | PRD US-04 / US-05 / US-10 AC, US-06 AC; hot-spot dir `src/components/plans` (5 commits/30d)                                          |
| 6   | Gear allocation produces wrong whole-unit fueling — the carb-led split, per-segment cap redistribution, pinned-override precedence, sodium/fluid gap-fill, or whole-unit rounding is off                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Medium | Medium     | PRD FR-004 / US-06 (the most complex business rule; decorates the guardrail calc)                                                    |

**Impact × Likelihood rubric.** Both axes are scored High / Medium / Low for
ordering, not false precision. High impact = a runner loses access, data, or
trusts a wrong race-day number; High likelihood = the area changes weekly or
the interview flagged it as under-tested/uncertain.

**Abuse / security lens.** The product has auth and accepts user input (GPX
uploads, plan parameters), so the map carries an explicit abuse scenario:
Risk #4 (IDOR / ownership at the API boundary). Risk #3 also has an
abuse edge (token replay / use-after-expiry). Malformed or hostile GPX input
is folded into Risk #1/#2 (input must be rejected gracefully, never crash or
silently corrupt the calc).

Risk numbers are stable across refreshes — append new risks at the bottom,
never renumber.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                                                          | Must challenge                                                                                                                                                                                                    | Context `/10x-research` must ground                                                                                                                           | Likely cheapest layer                                                                                      | Anti-pattern to avoid                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| #1   | Zero stations renders the explanatory state (no crash/empty table); a single station has defined behavior; a degenerate set (duplicate distance, beyond-total, non-monotonic elevation, out-of-order) is sorted/dropped/clamped, never silently fed to the calc as a negative segment                | "Happy path works ⇒ boundaries work"; "client-side validation is enough — the calc/server need not guard" (confirmed by research: no server cross-field validation, no DB CHECK; the pure calc is the only guard) | The calc entry point; where per-segment distance and segment weight are derived; what Zod/input validation exists; what the zero-station UI state actually is | unit (calc derivation) + unit render (`react-dom/server` explanatory/zero-station state — not integration) | Happy-path-only assertions; expected values copied from the implementation under test                     |
| #2   | A GPX file whose total gain/loss is **independently hand-computed** yields exactly those totals (within rounding); waypoint cumulative elevations match the fixture                                                                                                                                  | "The existing gpx test passing ⇒ elevation is correct" — it may assert the parser's own output (oracle problem); "more track points ⇒ more accurate" smoothing assumptions                                        | How gain/loss is accumulated (threshold? smoothing?); where computed totals are persisted; how a waypoint maps to an aid-station cumulative elevation         | unit (pure parse function against a fixture with an external oracle)                                       | An assertion lifted from parser output; a snapshot of computed totals with no independent oracle          |
| #3   | An expired token is rejected; a used token cannot be reused; a token issued for user A cannot delete user B; the emailed link is single-use; the fresh-OTP re-auth gate is enforced server-side                                                                                                      | "Final state is 'deleted' ⇒ the guard ran"; "a 30-minute expiry being set ⇒ it is enforced on use"                                                                                                                | The token table schema and hashing; where expiry and single-use are checked; the service-role admin delete path; the re-auth (fresh OTP) gate                 | integration (extend `tests/integration/account-deletion-tokens.test.ts`)                                   | Testing only the happy delete path; over-mocking the token store so the expiry/reuse guard never executes |
| #4   | A logged-in non-owner gets a 403/404 (not the data) on read/update/delete of another runner's plan, aid station, or gear; routes using the admin client still enforce ownership                                                                                                                      | "RLS covers it ⇒ every route is safe" — a service-role client bypasses RLS; "authenticated ⇒ authorized"                                                                                                          | Which routes use the anon-key SSR client vs `supabaseAdmin`; where ownership is checked in app code vs RLS; the RLS policies in `supabase/migrations`         | integration (two users, cross-access attempts; extend `tests/integration/rls-ownership.test.ts`)           | Testing only that the owner can access (happy path); trusting RLS for routes that run as service-role     |
| #5   | Deleting a station merges adjacent segments with combined distance/elevation; editing distance re-sorts and re-derives; adding inserts and re-derives; per-segment gear selections that no longer map are cleared                                                                                    | "Re-sort is stable / entry order doesn't matter"; "per-segment selections survive a layout change"                                                                                                                | The cumulative→segment derivation; the sort on distance change; the selection-clearing logic when the segment layout changes                                  | unit (derivation/merge) + integration (mutation → recompute → selection clear)                             | Brittle ordering assumptions; testing only single-station edits                                           |
| #6   | The carb target splits across sources by ratio; a per-segment cap redistributes the remainder to other carb sources; a pinned override wins over the suggestion; salt caps fill the sodium gap and a water carrier fills the fluid gap; quantities round to whole units; a layout change re-suggests | "Suggested total == target" — rounding means it will not match exactly; the signed delta is expected; "a cap and an override on the same product compose trivially"                                               | The allocation function signature; how caps and overrides interact; the sparse-deviation storage shape; the re-suggest trigger on layout change               | unit (pure allocator) + integration (sparse-deviation persistence + re-suggest)                            | An assertion copied from the allocator's own output; testing only the no-cap, no-override happy path      |

**Post-research corrections (Phase 3, 2026-07-02).** Ground-truth from
`context/changes/testing-authorization-account-deletion-safety/research.md`
refines the wording above for Risks #3 and #4:

- **Risk #4** — "especially routes using the service-role admin client that
  bypass RLS" **overstates the code surface**. The only service-role
  (RLS-bypassing) routes are the self/token-scoped account-deletion endpoints,
  none of which takes an attacker-controllable resource id. Ownership is proven
  cross-user at the DB/service layer for **all four** user tables (`plans`,
  `aid_stations`, `gear_items`, `gear_segment_selections`). The residual gap
  closed in Phase 3 was narrow: gear cross-user UPDATE/DELETE and the
  `plan_id`-less selection delete branch. True **route-level** authorization
  (HTTP 403/404/401 mapping) is **e2e-only** — not integration — and is
  deliberately deferred (see §7 / §6.6).
- **Risk #3** — the net-new work was two **consume-path** service tests: expiry
  enforcement and _isolated_ single-use. Audit-row survival was **already
  covered** (`account-deletion-execute.test.ts`) and actor-binding ("A's token
  can't delete B") is **structural** (execute has no session; the token names
  its own `user_id`), covered here only as a one-line defense-in-depth assert.
  A real **TOCTOU single-use race** in `markTokenUsed` was found and recorded as
  a deferred defect (see the Phase-3 note in §6.6) rather than tested.

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                         | Goal (one line)                                                                                                                                                                 | Risks covered | Test types                                | Status      | Change folder                                                    |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------- | ----------- | ---------------------------------------------------------------- |
| 1   | Plan-generation correctness & boundaries           | Prove the wedge calc handles degenerate/malformed input gracefully and computes correct numbers against an independent oracle                                                   | #1            | unit + render (no integration/e2e)        | complete    | `context/changes/testing-plan-generation-correctness/`           |
| 2   | Input-pipeline integrity (GPX + segment recompute) | Prove GPX-extracted totals/elevation are correct vs a known fixture and that aid-station mutations re-derive segments and clear stale selections                                | #2, #5        | unit + integration                        | complete    | `context/changes/testing-input-pipeline-integrity/`              |
| 3   | Authorization & account-deletion safety            | Prove ownership is enforced at the DB/service layer for all four user tables and the deletion token is single-use, expiring, and actor-bound (route/HTTP layer deferred to e2e) | #4, #3        | integration (route layer → e2e, deferred) | complete    | `context/changes/testing-authorization-account-deletion-safety/` |
| 4   | Gear allocation edge cases                         | Prove carb-led allocation with caps/overrides/redistribution/gap-fill is correct and re-suggests on layout change                                                               | #6            | unit + integration                        | not started | —                                                                |

**Status vocabulary** (fixed — parser literals):

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `not started`   | No change folder for this rollout phase yet.                        |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched`    | `research.md` exists in the change folder.                          |
| `planned`       | `plan.md` exists with a `## Progress` section.                      |
| `implementing`  | Progress section has at least one `[x]` and at least one `[ ]`.     |
| `complete`      | Progress section is fully `[x]`.                                    |

Order rationale: the guardrail calc (highest impact × likelihood, the
product wedge, and the user's #4 concern) is hardened first; the input
pipeline that feeds it (GPX + segment recompute) second; the irreversible
and security-sensitive surface (authorization + account deletion, the
mandatory abuse phase, and the user's #3 concern) third; the gear-allocation
decoration layer (medium impact, well-covered today) last. No AI-native or
quality-gates phase is included — hook/MCP/CI configuration is out of scope
for this rollout (see §5).

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                | Tool                                 | Version | Notes                                                                                                       |
| -------------------- | ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------- |
| unit + integration   | Vitest                               | ^4.1.9  | `node` environment; `include` scoped to `tests/unit/**/*.test.ts` + `tests/integration/**/*.test.ts`        |
| component render     | jsdom (via Vitest)                   | ^29.1.1 | used by `tests/unit/plan-table-render.test.ts`                                                              |
| e2e                  | Playwright                           | ^1.60.0 | `testMatch: **/*.spec.ts` only, so it never collects the Vitest `*.test.ts` files                           |
| API mocking          | none yet                             | —       | integration tests run against real Supabase (local) rather than a network mock; confirm in Phase 3 research |
| accessibility        | none yet                             | —       | not in scope for this rollout                                                                               |
| (optional) AI-native | Playwright MCP — checked: 2026-06-22 | n/a     | available in session; do NOT use where a deterministic Vitest/Playwright assertion already gives the signal |

**Stack grounding tools (current session):**

- Docs: none — no Context7 or framework-docs MCP exposed in this session; relied on local `package.json` + `vitest.config.ts` + `playwright.config.ts`; checked: 2026-06-22
- Search: Exa.ai — available; not used for the initial write (local config was sufficient); reach for it in per-phase research to verify current Vitest 4 / Playwright / Supabase test APIs; checked: 2026-06-22
- Runtime/browser: Playwright MCP — available; possible interactive verification layer for the zero-station / boundary UI states in Phase 1, but only beyond what a `*.spec.ts` already covers; checked: 2026-06-22
- Provider/platform: Supabase MCP — available (not yet authenticated); relevant in Phase 3 for inspecting RLS policies / auth state and as a possible future quality gate; checked: 2026-06-22

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                        | Where                       | Required?                 | Catches                                                                    |
| --------------------------- | --------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| lint + typecheck            | local + CI (`ci.yml`)       | required (already wired)  | syntactic / type drift                                                     |
| e2e on critical flows       | CI on PR (`playwright.yml`) | required (already wired)  | broken critical user paths                                                 |
| unit + integration (Vitest) | local                       | required after §3 Phase 1 | logic regressions in the calc, GPX, allocation, token, and ownership seams |
| pre-prod smoke              | between merge + prod        | optional                  | environment-specific failures on Cloudflare Workers                        |

Note: Vitest runs locally today but is not confirmed to run in CI
(`ci.yml` is lint + build; `playwright.yml` is e2e only). Wiring Vitest into
CI is a candidate gate but is **not** a rollout phase here — it is left as a
research finding for Phase 1, consistent with §3's exclusion of CI/config
work from this rollout.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section reads "TBD — see
§3 Phase <N>."

### 6.1 Adding a unit test

- **Location**: `tests/unit/<module>.test.ts` (pure logic; `node` env).
- **Reference test**: `tests/unit/plan-table.test.ts` (calc) — but verify it
  asserts against an independent oracle, not its own output (see §1 rule 4).
- **Run locally**: `npx vitest run tests/unit`.

**Calc-boundary pattern (Phase 1, Risk #1).** For pure functions like
`computePlanTable`, group worked-reference, edge, and boundary cases in
`describe` blocks within one file. Each numeric expectation is **hand-derived
from the PRD Business Logic and written as a comment beside the assertion**
(e.g. `// 590·50/120`), never read back from the function output. Reuse
module-level fixture factories (`makePlan` / `makeStation` with `Partial<…>`
overrides) so each case states only what differs. Degenerate-input cases
(out-of-order set, duplicate cumulative distance, station beyond total,
non-monotonic cumulative elevation, invalid `start_time`, `Infinity`) assert
the calc's _defensive_ behavior (sort, drop, clamp-to-0) **as intended** — a
later change to those branches must consciously update the test. Reference:
the `boundary cases` block (U1–U6) in `tests/unit/plan-table.test.ts`.

**Render-state pattern (Phase 1, Risk #1).** To assert a React component's
_output_ with no jsdom/RTL/new deps, render it with `renderToStaticMarkup`
(from `react-dom/server`) in the `node` env and assert on the HTML string:
`expect(html).toContain('data-testid="…"')` for presence and
`.not.toContain(…)` for absence (e.g. the `ok:false` explanatory state shows
`plan-table-error` and **not** `plan-table`). Count repeated rows by splitting
on the testid. Pass only the props the branch needs — optional props can be
omitted. Reference: the `explanatory + zero-station states` block (R1–R3) in
`tests/unit/plan-table-render.test.ts`.

### 6.2 Adding an integration test

- **Location**: `tests/integration/<feature>.test.ts` (`node` env, runs
  against local Supabase).
- **Mocking policy** (confirmed Phase 3 research, 2026-07-02): **no mocking** —
  integration tests run against a **locally running** Supabase (`npx supabase
start`), driving services or the DB directly. No test imports a route handler
  (endpoints import `astro:env/server`, not Vitest-importable) and none mocks an
  internal module. Reserve mocking for the network edge only, never internal
  modules.
- **Reference test**: `tests/integration/rls-ownership.test.ts` (ownership)
  and `tests/integration/account-deletion-tokens.test.ts` (token lifecycle).
- **Run locally**: `npx vitest run tests/integration`.

### 6.3 Adding an e2e test

- **Location**: `tests/<feature>.spec.ts` (Playwright; matched by
  `**/*.spec.ts` only).
- **Reference test**: `tests/plans-setup.spec.ts`; auth helper at
  `tests/helpers/otp.ts`.
- **Run locally**: `npx playwright test`.

### 6.4 Adding a test for GPX / input parsing

- **Location**: `tests/unit/gpx.test.ts` (`// @vitest-environment jsdom` — `parseGpx`
  needs a DOM; the math functions are pure/DOM-free). Static fixtures live in
  `tests/fixtures/*.gpx`.
- **Independent-oracle pattern (Phase 2, Risk #2)**: author a **synthetic, hand-computable**
  `.gpx` fixture — put track points on the equator one degree of longitude apart so each
  leg's 2D distance equals `DEG_LAT_M` (re-derived in the test from `π/180·6_371_000`, never
  imported from the source), and use integer elevation deltas. Compute the expected total
  distance/gain/loss **on paper from the coordinates** and assert the full
  `parseGpx → distance3dKm/elevationGainLoss/projectWaypointsToStations` chain against them
  (place a waypoint exactly on a track point for an unambiguous cumulative oracle). Add a
  true-geodetic check (1° latitude ≈ 111.19 km, a published literal) to pin the radius
  constant beyond the small-angle limit. Read fixtures with `readFileSync("tests/fixtures/…")`
  (cwd-relative — the jsdom env reports a non-file `import.meta.url`).
- **Reference test**: the `GPX extraction end-to-end (fixture)` block in `tests/unit/gpx.test.ts`.
- **Run locally**: `npx vitest run tests/unit/gpx.test.ts`.
- **Note**: the full file→DB persistence path is covered by
  `tests/integration/gpx-import-flow.test.ts` (a round-trip, not a GPX-math oracle); the
  browser file-upload→DB flow is deferred to e2e.

### 6.5 Adding a test for an authorization / ownership boundary

- **Location**: `tests/integration/<feature>.test.ts` (`node` env, local Supabase).
- **Two-user cross-access pattern (Phase 3, Risk #4)**: create two users via the
  service-role `admin` client, sign each into its own `anonClient()` with
  `signInWithPassword`, and have runner A seed the resource. Then attempt every
  cross-access as runner **B** and assert the RLS **no-op**, not merely the
  absence of an error: an INSERT on A's plan returns `42501`; a SELECT returns
  zero rows; an UPDATE/DELETE returns `data: []` (RLS scoped it to zero rows)
  **and** a re-read as owner A confirms the value is unchanged / the row
  survives. Use `Date.now()`-stamped emails so parallel runs don't collide, and
  clean up A's rows + both users in `afterAll`.
- **Service-role vs RLS**: the anon-key SSR client runs under RLS (ownership
  enforced by Postgres); the `supabaseAdmin` service-role client **bypasses RLS**
  entirely, so any path using it must enforce ownership in app code. Watch for
  service functions that filter by a partial key (e.g. `upsertGearSelection`'s
  delete branch filters `gear_item_id` + `segment_index` with no `plan_id`) —
  those rely solely on the RLS policy and must be proven cross-user.
- **Route/HTTP layer is e2e-only**: endpoint handlers import `astro:env/server`
  and cannot be imported under Vitest, so the HTTP status mapping
  (`PGRST116`→404, `42501`→403, missing session→401), the fresh-OTP re-auth gate,
  and the execute-no-session posture are covered by Playwright / manual checks,
  not integration tests. See §7 / the Phase-3 note in §6.6.
- **Reference tests**: `tests/integration/rls-ownership.test.ts` (plans +
  aid_stations), `tests/integration/gear-flow.test.ts` (gear_items +
  gear_segment_selections, incl. the Phase-3 cross-user UPDATE/DELETE block),
  `tests/integration/account-deletion-execute.test.ts` (token consume path).
- **Run locally**: `npx vitest run tests/integration/<feature>.test.ts`.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

**Phase 3 (Authorization & account-deletion safety, 2026-07-02).**

- **Deferred defect — TOCTOU single-use race.** `markTokenUsed`
  (`src/lib/services/account-deletion.ts:85-91`) is a bare
  `UPDATE ... SET used_at = now()` with **no `used_at IS NULL` predicate and no
  affected-row check**, and the read (`findValidDeletionToken`) and burn are two
  separate statements with no DB-level atomic guard (no partial unique index on
  unused tokens). Two concurrent executes of the same raw token can both pass the
  read gate. Sequential replay is blocked; concurrent replay is not. This is a
  code weakness, not a coverage gap — recorded here and deferred to a dedicated
  fix change (compare-and-set `.update({used_at}).is("used_at", null)` +
  affected-row check, or a partial unique index): see
  `context/changes/fix-account-deletion-token-toctou/`. A characterization test
  was deliberately **not** added (inherently flaky against local Supabase; would
  document the bug as expected).
- **Route/HTTP layer is e2e-only.** Endpoint handlers import `astro:env/server`
  and cannot be imported under Vitest, so route-level IDOR mapping
  (`PGRST116`→404, `42501`→403, missing session→401), the fresh-OTP re-auth gate
  (`verify.ts`), and the execute-no-session posture are **not** covered by
  integration tests. They stay verified manually / in Playwright and are
  recorded as a deliberate deferral in §7.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Public marketing / legal pages (welcome, about, contact)** — static
  content, low blast radius. Re-evaluate if a public page gains a backend
  affordance (e.g. a real contact form replacing the mailto). (Source: Phase
  2 interview Q5.)
- **Field-help tooltip text** — presentation only; breaks loudly and
  visibly. Re-evaluate if tooltip content becomes dynamic or data-driven.
  (Source: Phase 2 interview Q5.)
- **Collapsible-section UX and Excel exact cell styling** — as long as the
  numbers are correct (covered by `tests/unit/plan-export.test.ts`), exact
  layout/formatting is not worth brittle snapshot tests. (Source: Phase 2
  interview Q5, by extension.)
- **Route/HTTP authorization layer via integration tests** — endpoint handlers
  import `astro:env/server` and cannot be imported under Vitest, so the HTTP
  status mapping (403/404/401 for a cross-user caller), the fresh-OTP re-auth
  gate, and the execute-no-session posture are **not** covered by integration
  tests. They are verified manually / in Playwright and deferred to a future e2e
  slice. Re-evaluate if endpoints become Vitest-importable or an e2e
  authorization suite is prioritized. (Source: Phase 3 research, 2026-07-02.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-22
- Stack versions last verified: 2026-06-22
- AI-native tool references last verified: 2026-06-22

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.

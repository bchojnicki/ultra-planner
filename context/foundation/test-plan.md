# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-22 (Phase 1 researched)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression. This project already has a meaningful suite — every test
   the rollout adds must close a *gap*, not duplicate existing coverage.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the ground
   truth.

A fourth rule is specific to a project that already has tests: **coverage
is not protection.** A green test that lifted its expected value from the
implementation under test (the oracle problem) green-lights current
behavior, including current bugs. Every gap this rollout closes must derive
its expected value from an *independent* oracle — the PRD's Business Logic,
a hand-computed fixture, or the interview — not from the code being tested.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (excluding
`node_modules`, `dist`, `.astro`, docs, archive).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Plan generation mishandles degenerate or malformed input — zero aid stations, a single station, or **cumulative distances that decrease** — producing a negative segment distance, a crash, or silently wrong numbers instead of the explanatory state the PRD requires | High | High | interview Q4; PRD US-01 AC (zero-station explanatory state); PRD Business Logic (segment-weight derivation) |
| 2 | GPX elevation extraction is wrong at the source, so total distance/elevation **and every downstream segment time and nutrition number** inherit the error silently | High | Medium | interview Q1; PRD FR-013 / Business Logic; hot-spot dir `src/lib` (5 commits/30d) |
| 3 | The account-deletion confirmation token can be replayed, used after expiry, or used to delete the wrong account; the emailed link is not truly single-use, or the fresh-OTP re-auth gate is bypassable | High | Medium | interview Q3; PRD FR-014; hot-spot dir `src/pages/api/account/deletion` (5 commits/30d) |
| 4 | A logged-in runner reaches or mutates **another** runner's plan, aid station, or gear via a route that checks "authenticated" but not "owner" — especially routes using the service-role admin client that bypass row-level security (abuse / IDOR) | High | Medium | PRD Access Control + privacy NFR; abuse/security lens; hot-spot dirs `src/lib` (`supabaseAdmin`), `src/lib/services` (3 commits/30d) |
| 5 | Segment recompute after adding, editing, or deleting an aid station is wrong — failing to merge adjacent segments on delete, to re-sort on a distance change, to re-derive per-segment distance/elevation, or to clear stale per-segment gear selections that no longer map | High | Medium | PRD US-04 / US-05 / US-10 AC, US-06 AC; hot-spot dir `src/components/plans` (5 commits/30d) |
| 6 | Gear allocation produces wrong whole-unit fueling — the carb-led split, per-segment cap redistribution, pinned-override precedence, sodium/fluid gap-fill, or whole-unit rounding is off | Medium | Medium | PRD FR-004 / US-06 (the most complex business rule; decorates the guardrail calc) |

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

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Zero stations renders the explanatory state (no crash/empty table); a single station has defined behavior; a decreasing cumulative distance is rejected or surfaced, never silently fed to the calc as a negative segment | "Happy path works ⇒ boundaries work"; "client-side validation is enough — the calc/server need not guard" | The calc entry point; where per-segment distance and segment weight are derived; what Zod/input validation exists; what the zero-station UI state actually is | unit (derivation/calc) + integration (rendered zero-station state) | Happy-path-only assertions; expected values copied from the implementation under test |
| #2 | A GPX file whose total gain/loss is **independently hand-computed** yields exactly those totals (within rounding); waypoint cumulative elevations match the fixture | "The existing gpx test passing ⇒ elevation is correct" — it may assert the parser's own output (oracle problem); "more track points ⇒ more accurate" smoothing assumptions | How gain/loss is accumulated (threshold? smoothing?); where computed totals are persisted; how a waypoint maps to an aid-station cumulative elevation | unit (pure parse function against a fixture with an external oracle) | An assertion lifted from parser output; a snapshot of computed totals with no independent oracle |
| #3 | An expired token is rejected; a used token cannot be reused; a token issued for user A cannot delete user B; the emailed link is single-use; the fresh-OTP re-auth gate is enforced server-side | "Final state is 'deleted' ⇒ the guard ran"; "a 30-minute expiry being set ⇒ it is enforced on use" | The token table schema and hashing; where expiry and single-use are checked; the service-role admin delete path; the re-auth (fresh OTP) gate | integration (extend `tests/integration/account-deletion-tokens.test.ts`) | Testing only the happy delete path; over-mocking the token store so the expiry/reuse guard never executes |
| #4 | A logged-in non-owner gets a 403/404 (not the data) on read/update/delete of another runner's plan, aid station, or gear; routes using the admin client still enforce ownership | "RLS covers it ⇒ every route is safe" — a service-role client bypasses RLS; "authenticated ⇒ authorized" | Which routes use the anon-key SSR client vs `supabaseAdmin`; where ownership is checked in app code vs RLS; the RLS policies in `supabase/migrations` | integration (two users, cross-access attempts; extend `tests/integration/rls-ownership.test.ts`) | Testing only that the owner can access (happy path); trusting RLS for routes that run as service-role |
| #5 | Deleting a station merges adjacent segments with combined distance/elevation; editing distance re-sorts and re-derives; adding inserts and re-derives; per-segment gear selections that no longer map are cleared | "Re-sort is stable / entry order doesn't matter"; "per-segment selections survive a layout change" | The cumulative→segment derivation; the sort on distance change; the selection-clearing logic when the segment layout changes | unit (derivation/merge) + integration (mutation → recompute → selection clear) | Brittle ordering assumptions; testing only single-station edits |
| #6 | The carb target splits across sources by ratio; a per-segment cap redistributes the remainder to other carb sources; a pinned override wins over the suggestion; salt caps fill the sodium gap and a water carrier fills the fluid gap; quantities round to whole units; a layout change re-suggests | "Suggested total == target" — rounding means it will not match exactly; the signed delta is expected; "a cap and an override on the same product compose trivially" | The allocation function signature; how caps and overrides interact; the sparse-deviation storage shape; the re-suggest trigger on layout change | unit (pure allocator) + integration (sparse-deviation persistence + re-suggest) | An assertion copied from the allocator's own output; testing only the no-cap, no-override happy path |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Plan-generation correctness & boundaries | Prove the wedge calc handles degenerate/malformed input gracefully and computes correct numbers against an independent oracle | #1 | unit + render (no integration/e2e) | researched | `context/changes/testing-plan-generation-correctness/` |
| 2 | Input-pipeline integrity (GPX + segment recompute) | Prove GPX-extracted totals/elevation are correct vs a known fixture and that aid-station mutations re-derive segments and clear stale selections | #2, #5 | unit + integration | not started | — |
| 3 | Authorization & account-deletion safety | Prove ownership is enforced at the API boundary (incl. admin-client routes) and the deletion token is single-use, expiring, and actor-bound | #4, #3 | integration | not started | — |
| 4 | Gear allocation edge cases | Prove carb-led allocation with caps/overrides/redistribution/gap-fill is correct and re-suggests on layout change | #6 | unit + integration | not started | — |

**Status vocabulary** (fixed — parser literals):

| Value | Meaning |
|---|---|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

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

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest | ^4.1.9 | `node` environment; `include` scoped to `tests/unit/**/*.test.ts` + `tests/integration/**/*.test.ts` |
| component render | jsdom (via Vitest) | ^29.1.1 | used by `tests/unit/plan-table-render.test.ts` |
| e2e | Playwright | ^1.60.0 | `testMatch: **/*.spec.ts` only, so it never collects the Vitest `*.test.ts` files |
| API mocking | none yet | — | integration tests run against real Supabase (local) rather than a network mock; confirm in Phase 3 research |
| accessibility | none yet | — | not in scope for this rollout |
| (optional) AI-native | Playwright MCP — checked: 2026-06-22 | n/a | available in session; do NOT use where a deterministic Vitest/Playwright assertion already gives the signal |

**Stack grounding tools (current session):**
- Docs: none — no Context7 or framework-docs MCP exposed in this session; relied on local `package.json` + `vitest.config.ts` + `playwright.config.ts`; checked: 2026-06-22
- Search: Exa.ai — available; not used for the initial write (local config was sufficient); reach for it in per-phase research to verify current Vitest 4 / Playwright / Supabase test APIs; checked: 2026-06-22
- Runtime/browser: Playwright MCP — available; possible interactive verification layer for the zero-station / boundary UI states in Phase 1, but only beyond what a `*.spec.ts` already covers; checked: 2026-06-22
- Provider/platform: Supabase MCP — available (not yet authenticated); relevant in Phase 3 for inspecting RLS policies / auth state and as a possible future quality gate; checked: 2026-06-22

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | local + CI (`ci.yml`) | required (already wired) | syntactic / type drift |
| e2e on critical flows | CI on PR (`playwright.yml`) | required (already wired) | broken critical user paths |
| unit + integration (Vitest) | local | required after §3 Phase 1 | logic regressions in the calc, GPX, allocation, token, and ownership seams |
| pre-prod smoke | between merge + prod | optional | environment-specific failures on Cloudflare Workers |

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
the calc's *defensive* behavior (sort, drop, clamp-to-0) **as intended** — a
later change to those branches must consciously update the test. Reference:
the `boundary cases` block (U1–U6) in `tests/unit/plan-table.test.ts`.

**Render-state pattern (Phase 1, Risk #1).** To assert a React component's
*output* with no jsdom/RTL/new deps, render it with `renderToStaticMarkup`
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
- **Mocking policy**: TBD — Phase 3 research must confirm the real-DB vs
  mock-at-edge boundary; default is "mock only at the network edge, never
  internal modules."
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

- TBD — see §3 Phase 2 for the GPX-elevation independent-oracle pattern
  (a fixture whose total gain/loss is hand-computed, not read back from the
  parser). Existing seams: `tests/unit/gpx.test.ts`,
  `tests/integration/gpx-import-flow.test.ts`.

### 6.5 Adding a test for an authorization / ownership boundary

- TBD — see §3 Phase 3 for the two-user cross-access (IDOR) pattern and the
  service-role-vs-RLS distinction. Existing seam:
  `tests/integration/rls-ownership.test.ts`.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

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

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-22
- Stack versions last verified: 2026-06-22
- AI-native tool references last verified: 2026-06-22

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.

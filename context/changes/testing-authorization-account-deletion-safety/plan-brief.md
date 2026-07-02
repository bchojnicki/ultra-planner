# Authorization (IDOR) & Account-Deletion Token Safety — Plan Brief

> Full plan: `context/changes/testing-authorization-account-deletion-safety/plan.md`
> Research: `context/changes/testing-authorization-account-deletion-safety/research.md`

## What & Why

Rollout **Phase 3** of the test plan: a **test-only** change closing the net-new coverage gaps for **Risk #3** (account-deletion token replay / use-after-expiry / wrong-account) and **Risk #4** (a logged-in runner reaching another runner's data — IDOR). Research proved no defect exists in either area and that coverage is broadly in place — so the job is small, surgical, and high-signal, not a sweep.

## Starting Point

Ownership is enforced by Postgres RLS uniformly across all four user tables, and cross-user isolation is already proven for `plans`/`aid_stations` and for gear INSERT/SELECT. The token model (hash-stored, 30-min TTL, single-use read gate) is sound and its issuance + full execute-cascade are tested. The residue: gear cross-user UPDATE/DELETE and the `plan_id`-less delete branch are untested; token expiry-on-consume and *isolated* single-use are untested; and `markTokenUsed` is non-atomic (a real TOCTOU race).

## Desired End State

`npx vitest run tests/integration` passes with new tests that reject an expired token on consume, prove single-use in isolation (user still present) with a second user untouched, and prove cross-user gear UPDATE/DELETE and the delete branch are no-ops. The test-plan docs are updated (§6.5 pattern, §2/§3 corrections, route-layer e2e deferral), and the TOCTOU race is recorded as a deferred defect with a follow-up change opened.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Route-layer (e2e) scope | Integration-only, defer route layer | Matches the §3 "integration" charter and the astro:env boundary; endpoint HTTP/OTP proofs stay Playwright/manual, explicitly deferred | Plan |
| TOCTOU weakness | Flag as deferred defect + open follow-up | Honors the test-only charter and avoids a flaky race test; the compare-and-set fix gets its own change | Research + Plan |
| Gear residue depth | Delete-branch + minimal UPDATE/DELETE | Closes the one distinct gap (delete branch) and rounds the CRUD matrix without re-proving the same pattern | Plan |
| File organization | Extend existing files | Reuses each file's harness and keeps related coverage together | Plan |
| Actor-binding test | Yes, one-line B-untouched assertion | Documents the structural guarantee executably at near-zero cost | Plan |

## Scope

**In scope:** Risk #3 consume-path tests (expiry, isolated single-use, actor-binding); Risk #4 gear cross-user UPDATE/DELETE + delete branch; test-plan doc updates; TOCTOU deferred-defect record + follow-up change.

**Out of scope:** Any production code change (incl. the TOCTOU fix); route/endpoint tests; concurrency characterization test; re-testing already-covered ground; new infra/CI/mocking.

## Architecture / Approach

Extend three existing integration files (`account-deletion-tokens.test.ts`, `account-deletion-execute.test.ts`, `gear-flow.test.ts`) reusing their local-Supabase harness (`assertLocal`, service-role `admin`, two `anonClient()` runners). Every expected value derives from an independent oracle (the token contract, the RLS policy intent), never read back from the code under test. Docs and the deferred-defect record land in a final close-out phase.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Risk #3 consume-path tests | Expiry rejection, isolated single-use, actor-binding | Isolating `used_at` from the cascade confound |
| 2. Risk #4 gear residue | Cross-user UPDATE/DELETE + `plan_id`-less delete branch | Low incremental signal over proven INSERT/SELECT |
| 3. Docs & close-out | §6.5 pattern, §2/§3 corrections, TOCTOU record + follow-up | Making the e2e deferral read as deliberate, not overlooked |

**Prerequisites:** Local Supabase running (`npx supabase start`); the existing integration suite green.
**Estimated effort:** ~1 session across 3 phases (mostly small test additions + doc edits).

## Open Risks & Assumptions

- The TOCTOU race stays live in production until the deferred follow-up change lands.
- The route-layer authorization contracts (HTTP 403/404/401, fresh-OTP gate, execute-no-session) remain proven only manually/e2e, by design.
- Gear UPDATE/DELETE cross-user cases add modest signal over the already-proven INSERT/SELECT pattern.

## Success Criteria (Summary)

- An expired or already-used deletion token is provably rejected at consume time, in isolation from the cascade.
- A non-owner cannot update, delete, or (via the delete branch) remove another runner's gear or selections.
- The test-plan reflects Phase-3 completion, the corrected risk framing, and a recorded + assigned TOCTOU fix.

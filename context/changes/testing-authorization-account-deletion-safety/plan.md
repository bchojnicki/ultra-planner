# Authorization (IDOR) & Account-Deletion Token Safety — Implementation Plan

## Overview

Rollout **Phase 3** of `context/foundation/test-plan.md` — a **test-only** change that closes the genuinely net-new coverage gaps for **Risk #3** (account-deletion token replay / use-after-expiry / wrong-account) and **Risk #4** (a logged-in runner reaching another runner's data — IDOR). Research (`research.md`) already ground-truthed the codebase: no IDOR defect exists, the token model is sound, and cross-user isolation is broadly proven. This plan adds only the small, high-signal Vitest integration tests that remain, records one real code weakness (a TOCTOU single-use race) as a deferred defect, and updates the test-plan docs.

## Current State Analysis

- **Two Supabase clients define the whole Risk #4 surface.** `createClient` (`src/lib/supabase.ts:6-25`) uses the anon key with request cookies → RLS enforces ownership; app code never filters by `user_id`. `createAdminClient` (`src/lib/supabaseAdmin.ts:16-24`) uses the service-role key → RLS bypassed. All four `supabaseAdmin` call sites are the self/token-scoped account-deletion endpoints (`request.ts:25`, `verify.ts:23`, `execute.ts:27`, `confirm.astro:13`); **none takes an attacker-controllable resource id.** The risk's "service-role routes bypass RLS → IDOR" framing does not match a real code surface.
- **Cross-user RLS isolation is already proven** for all four user tables: `plans` + `aid_stations` (SELECT/UPDATE/DELETE no-op + INSERT WITH CHECK, `tests/integration/rls-ownership.test.ts:144-236`); `gear_items` + `gear_segment_selections` (INSERT→42501, SELECT hidden, `tests/integration/gear-flow.test.ts:140-252`). **Only INSERT/SELECT are proven cross-user for the two gear tables.**
- **The account-deletion token model** (`src/lib/services/account-deletion.ts`) imports no `astro:env` → fully Vitest-importable. `findValidDeletionToken` (`:69-80`) is the consume-side read gate: `.eq("token_hash").is("used_at", null).gt("expires_at", now)`. `markTokenUsed` (`:85-91`) is a **bare** `.update({used_at}).eq("token_hash")` — no `used_at IS NULL` predicate, no affected-row check.
- **Existing Risk #3 coverage** proves issuance (hashing, ~30-min expiry, throttle) and the full execute sequence with cascade + surviving audit row (`account-deletion-execute.test.ts:95-130`), but the replay assertion (`:124`) runs _after_ `markTokenUsed` **and** the cascade delete, so it never isolates the `used_at` guard, and **nothing** back-dates `expires_at` to test expiry on the consume path.
- **The `astro:env` boundary** splits the pyramid: service/DB logic → Vitest integration (cheap, deterministic); route/HTTP/session/OTP wiring → Playwright e2e only. No integration test imports a route handler.
- **Test harness** (reused verbatim): `assertLocal(url)` localhost guard (`ALLOW_REMOTE_DELETION_TEST=1` / `ALLOW_REMOTE_RLS_TEST=1` overrides), CLI-demo `DEFAULT_URL`/keys, `admin` service-role client, `anonClient()` + `signInWithPassword` per runner, `Date.now()`-stamped emails, password `test-password-123!`. `vitest.config.ts` runs `fileParallelism: false`; `npx vitest run tests/integration` requires a locally running Supabase.

## Desired End State

`npx vitest run tests/integration` passes with new coverage that:

- rejects an **expired** deletion token on the consume path (`findValidDeletionToken` → null after back-dating `expires_at`);
- proves single-use **in isolation** — `markTokenUsed` alone burns the token with the user still present (no cascade confound) — and that a second user B is untouched;
- proves cross-user **UPDATE/DELETE** is a no-op on both gear tables and that the `plan_id`-less `upsertGearSelection` delete branch cannot touch another runner's selection.

The test-plan is updated: Cookbook §6.5 documents the IDOR/ownership pattern, §2/§3 carry research's backport corrections, the route-layer (e2e) is recorded as a deliberate deferral, the TOCTOU race is recorded as a deferred defect with a follow-up change opened, and the §3 Phase-3 status reflects completion.

### Key Discoveries:

- `src/lib/services/account-deletion.ts:69-80` — consume read gate enforces expiry + single-use in one query; `:85-91` — `markTokenUsed` is non-atomic (TOCTOU).
- `src/lib/services/gear-selections.ts:35-39` — `upsertGearSelection` delete branch filters only `.eq("gear_item_id").eq("segment_index")`, **no `plan_id`** — relies entirely on the RLS DELETE policy cross-user (untested).
- `tests/integration/account-deletion-execute.test.ts:124` — existing replay assertion is cascade-confounded; does not isolate `used_at`.
- `tests/integration/gear-flow.test.ts:140-252` — cross-user gear pattern to extend (INSERT/SELECT proven; UPDATE/DELETE not).
- `supabase/migrations/20260619120000_create_account_deletion_tokens.sql` — RLS-enabled/zero-policy, **no** DB-level single-use guard (no partial unique index on unused tokens).

## What We're NOT Doing

- **No production code changes.** This is a test-only rollout phase (per §3 charter). The TOCTOU fix to `markTokenUsed` is deferred to a separate `/10x-new` change.
- **No route-layer / endpoint tests.** Route handlers import `astro:env/server` and cannot run under Vitest; the HTTP 403/404/401 mapping, fresh-OTP gate, and execute-no-session posture stay verified manually / in Playwright, and are recorded as a deliberate e2e deferral.
- **No concurrency / TOCTOU characterization test** — inherently flaky against local Supabase and would document a bug as "expected."
- **No re-testing of already-covered ground**: token issuance/hashing/expiry-at-mint, throttle predicate, execute cascade, audit-row survival (`execute.test.ts:118-121`), or cross-user gear INSERT/SELECT.
- **No new test infrastructure, CI wiring, or mocking** — reuse the existing local-Supabase harness.

## Implementation Approach

Extend the existing integration files rather than create new ones, reusing each file's harness (per the file-layout decision). Two test-writing phases map to the two risks, then a docs/close-out phase. Every expected value derives from an independent oracle (the token lifecycle contract, the RLS policy intent) — never read back from the code under test. Each new assertion carries a comment naming what it proves and why it is net-new versus existing coverage.

## Phase 1: Risk #3 — Account-Deletion Consume-Path Tests

### Overview

Add the two net-new consume-path service tests (expiry enforcement, isolated single-use) plus a one-line actor-binding assertion, extending the existing account-deletion integration files and reusing their harness.

### Changes Required:

#### 1. Expiry enforcement on the consume path

**File**: `tests/integration/account-deletion-tokens.test.ts` (or `-execute.test.ts` — place with the consume-path assertions)

**Intent**: Prove a token past its TTL is rejected at consume time — the "used after expiry" concern that is currently untested anywhere. Issue a token, back-date `expires_at` into the past via the admin client, then assert `findValidDeletionToken` returns null.

**Contract**: New `it(...)` using `issueDeletionToken(admin, userId, ip)` → `admin.from("account_deletion_tokens").update({ expires_at: <past ISO> }).eq("user_id", userId)` → `expect(await findValidDeletionToken(admin, raw)).toBeNull()`. Independent oracle: the `.gt("expires_at", now)` gate contract, not the code's output.

#### 2. Isolated single-use on the consume path

**File**: `tests/integration/account-deletion-execute.test.ts`

**Intent**: Prove the `used_at` guard alone burns the token, decoupled from the cascade delete that confounds the existing replay assertion (`:124`). Issue → `markTokenUsed(hash)` → assert `findValidDeletionToken` returns null **with the user (and token row) still present** — no `deleteUser`.

**Contract**: New `it(...)` in a fresh describe/user scope (do not reuse the destructive test's user). Sequence: `issueDeletionToken` → `findValidDeletionToken` (non-null) → `markTokenUsed(row.token_hash)` → `findValidDeletionToken` → `toBeNull()`; then assert the user still exists (`admin.auth.admin.getUserById` non-null) to prove isolation from the cascade.

#### 3. Actor-binding defense-in-depth assertion

**File**: `tests/integration/account-deletion-execute.test.ts` (within the Change #2 scope)

**Intent**: Document executably that consuming user A's token leaves a second user B entirely untouched — the structural "cannot delete the wrong account" guarantee. Low cost, guards against regression of the token-names-its-own-owner invariant.

**Contract**: Seed a second user B in the same describe's `beforeAll`; after A's `markTokenUsed`, add a one-line assertion that B's user record (and any seeded row) is still present. No new destructive path.

### Success Criteria:

#### Automated Verification:

- [ ] Integration tests pass: `npx vitest run tests/integration/account-deletion-tokens.test.ts tests/integration/account-deletion-execute.test.ts`
- [ ] Type checking passes: `npm run build` (or `npx astro sync && npx tsc --noEmit` if a faster check is preferred)
- [ ] Linting passes: `npm run lint`
- [ ] Expiry test fails if the `.gt("expires_at", now)` gate is removed from `findValidDeletionToken` (spot-check by temporarily loosening the gate locally)

#### Manual Verification:

- [ ] The isolated single-use test asserts token-null **with the user still present** — confirm no `deleteUser` runs in that test body
- [ ] Each new assertion has a comment naming the independent oracle and why it is net-new vs existing coverage

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Risk #4 — Gear Cross-User Authorization Residue

### Overview

Close the narrow untested residue in the gear ownership matrix by extending `gear-flow.test.ts`: the `plan_id`-less `upsertGearSelection` delete branch cross-user, plus one cross-user UPDATE and one DELETE per gear table.

### Changes Required:

#### 1. `plan_id`-less delete-branch cross-user

**File**: `tests/integration/gear-flow.test.ts`

**Intent**: Prove that `upsertGearSelection`'s delete branch (`src/lib/services/gear-selections.ts:35-39`) — which filters only `gear_item_id` + `segment_index`, relying purely on the RLS DELETE policy — cannot remove another runner's selection when invoked by a non-owner. This is the one gear path with distinct risk (no `plan_id` scoping in app code).

**Contract**: Reuse the existing two-user describe (`clientA`/`clientB`, `planAId`). Runner A creates a gear item + selection; runner B calls the service delete branch (or the equivalent `.delete().eq("gear_item_id").eq("segment_index")` as B) targeting A's selection; assert A's selection still exists (RLS scoped B's delete to zero rows).

#### 2. Cross-user UPDATE / DELETE on both gear tables

**File**: `tests/integration/gear-flow.test.ts`

**Intent**: Round out the CRUD matrix — INSERT/SELECT are already proven cross-user; add one cross-user UPDATE and one DELETE per table (`gear_items`, `gear_segment_selections`) to exercise the untested-but-existing RLS UPDATE/DELETE policies.

**Contract**: Within the existing two-user describe: A seeds a row; B attempts `.update({...}).eq("id", ...)` and `.delete().eq("id", ...)` → assert zero rows affected / row unchanged (RLS no-op, matching the `rls-ownership.test.ts` pattern for plans/aid_stations). Clean up A's seeded rows.

### Success Criteria:

#### Automated Verification:

- [ ] Integration tests pass: `npx vitest run tests/integration/gear-flow.test.ts`
- [ ] Full integration suite still green: `npx vitest run tests/integration`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:

- [ ] The delete-branch test proves A's selection **survives** B's attempt (not merely that B got no error)
- [ ] UPDATE/DELETE no-op assertions check row state, not just the absence of a thrown error

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Docs, Deferred-Defect Record & Close-Out

### Overview

Update `context/foundation/test-plan.md` to reflect Phase 3 completion, apply research's backport corrections, document the IDOR/ownership cookbook pattern, record the route-layer e2e deferral, and record the TOCTOU race as a deferred defect with a follow-up change opened via `/10x-new`.

### Changes Required:

#### 1. Cookbook §6.5 — authorization / ownership boundary pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.5 "TBD" with the concrete two-user cross-access pattern this phase used, so future authorization tests follow it.

**Contract**: Fill §6.5 with: location (`tests/integration/<feature>.test.ts`), the two-user `anonClient()` + `signInWithPassword` harness, "assert the non-owner's mutation is a no-op / RLS returns zero rows, not just no error," reference tests (`rls-ownership.test.ts`, `gear-flow.test.ts`), the service-role-vs-RLS distinction, and the note that route-level (HTTP 403/404/401) coverage is e2e-only.

#### 2. §2/§3 backport corrections + route-layer deferral

**File**: `context/foundation/test-plan.md`

**Intent**: Apply the three backport corrections research recommends (research.md §"Backport corrections") and record the route layer as a deliberate e2e deferral: reframe Risk #4 wording away from "service-role routes bypass RLS," note the ownership guarantee is proven cross-user at the DB/service layer, and narrow Risk #3 to the two consume-path tests with audit-survival/actor-binding marked already-covered/structural.

**Contract**: Edit the Risk #4 and Risk #3 rows / response-guidance text in §2 and the Phase-3 row note in §3; add an explicit line that the endpoint HTTP layer (IDOR mapping, fresh-OTP gate, execute-no-session) is intentionally deferred to e2e/manual. Update the §3 Phase-3 Status and the top-of-file "Last updated" line.

#### 3. TOCTOU deferred-defect record + follow-up change

**File**: `context/foundation/test-plan.md` (finding note) and a new change folder via `/10x-new`

**Intent**: Record the non-atomic `markTokenUsed` TOCTOU single-use race (`src/lib/services/account-deletion.ts:85-91`) as a known deferred defect and open a follow-up change for the fix (compare-and-set `.update({used_at}).is("used_at", null)` + affected-row check, or a partial unique index on unused tokens) — keeping this rollout test-only.

**Contract**: Add a short finding note (where §5/§7 or a Phase-3 note fits best) naming the weakness, the file:line, and the recommended fix; run `/10x-new` to scaffold a `context/changes/<id>/` for the fix and reference it from the note.

### Success Criteria:

#### Automated Verification:

- [ ] `context/foundation/test-plan.md` §6.5 no longer contains "TBD" for the authorization pattern
- [ ] §3 Phase-3 Status is updated and the file's "Last updated" line reflects this change
- [ ] Follow-up change folder exists: `ls context/changes/<toctou-fix-id>/change.md`
- [ ] Prettier passes on the edited markdown: `npm run format` (or lint-staged on commit)

#### Manual Verification:

- [ ] §2/§3 wording matches research's backport corrections (Risk #4 no longer overstates the service-role surface; Risk #3 narrowed to consume-path)
- [ ] The route-layer e2e deferral is explicit enough that a future reader can tell "deferred" from "overlooked"
- [ ] The TOCTOU finding names the file:line and the recommended fix, and links the follow-up change

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- None. This phase is integration-only; the pure-logic layer for these risks has no net-new gap.

### Integration Tests:

- Risk #3 consume path: expiry rejection, isolated single-use (user-present), actor-binding B-untouched.
- Risk #4 gear residue: `plan_id`-less delete branch cross-user, cross-user UPDATE/DELETE no-op on both gear tables.

### Manual Testing Steps:

1. `npx supabase start` (+ `db reset` if needed) so local Supabase is running.
2. `npx vitest run tests/integration` — confirm all new tests pass and the full suite is green.
3. Spot-check that the expiry test fails when the `.gt("expires_at", now)` gate is loosened, and the isolated single-use test fails when the `used_at` gate is loosened (proves the tests bind to the guard, not a happy path).

## Performance Considerations

`fileParallelism: false` and per-test user create/delete make integration runs stateful and sequential; keep new tests to their own user scopes to avoid cross-test contamination. No performance budget concerns for a test-only change.

## Migration Notes

None — no schema or production code changes. The deferred TOCTOU fix (its own change) may add a partial unique index migration; out of scope here.

## References

- Research: `context/changes/testing-authorization-account-deletion-safety/research.md`
- Change identity: `context/changes/testing-authorization-account-deletion-safety/change.md`
- Test plan charter: `context/foundation/test-plan.md` §2 (Risk #3/#4), §3 (Phase 3), §6.5
- Consume gate + TOCTOU: `src/lib/services/account-deletion.ts:69-80`, `:85-91`
- `plan_id`-less delete branch: `src/lib/services/gear-selections.ts:35-39`
- Existing seams: `tests/integration/account-deletion-execute.test.ts:95-130`, `tests/integration/account-deletion-tokens.test.ts:65-105`, `tests/integration/gear-flow.test.ts:140-252`, `tests/integration/rls-ownership.test.ts:144-236`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #3 — Account-Deletion Consume-Path Tests

#### Automated

- [x] 1.1 Integration tests pass: `npx vitest run tests/integration/account-deletion-tokens.test.ts tests/integration/account-deletion-execute.test.ts` — 08ffc69
- [x] 1.2 Type checking passes (`npm run build` or `npx astro sync && npx tsc --noEmit`) — 08ffc69
- [x] 1.3 Linting passes: `npm run lint` — 08ffc69
- [x] 1.4 Expiry test fails if the `.gt("expires_at", now)` gate is removed (deliberate-break spot-check) — 08ffc69

#### Manual

- [x] 1.5 Isolated single-use test asserts token-null with the user still present (no `deleteUser` in body) — 08ffc69
- [x] 1.6 Each new assertion comments its independent oracle and net-new rationale — 08ffc69

### Phase 2: Risk #4 — Gear Cross-User Authorization Residue

#### Automated

- [x] 2.1 Integration tests pass: `npx vitest run tests/integration/gear-flow.test.ts` — 857a23e
- [x] 2.2 Full integration suite green: `npx vitest run tests/integration` — 857a23e
- [x] 2.3 Linting passes: `npm run lint` — 857a23e

#### Manual

- [x] 2.4 Delete-branch test proves A's selection survives B's attempt — 857a23e
- [x] 2.5 UPDATE/DELETE no-op assertions check row state, not just absence of error — 857a23e

### Phase 3: Docs, Deferred-Defect Record & Close-Out

#### Automated

- [x] 3.1 §6.5 no longer contains "TBD" for the authorization pattern
- [x] 3.2 §3 Phase-3 Status updated and file "Last updated" line reflects this change
- [x] 3.3 Follow-up change folder exists: `ls context/changes/<toctou-fix-id>/change.md`
- [x] 3.4 Prettier passes on edited markdown: `npm run format`

#### Manual

- [x] 3.5 §2/§3 wording matches research's backport corrections
- [x] 3.6 Route-layer e2e deferral is explicit (deferred vs overlooked distinguishable)
- [x] 3.7 TOCTOU finding names file:line + recommended fix and links the follow-up change

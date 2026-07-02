# Fix TOCTOU Single-Use Race in Account-Deletion Token Consumption — Implementation Plan

## Overview

Close the deferred TOCTOU single-use race on the account-deletion consume path. Today `execute.ts` reads a token (`findValidDeletionToken`) and burns it (`markTokenUsed`) in two separate statements with several awaits between, and the burn is a non-atomic bare `UPDATE` — so two concurrent POSTs of the same raw token both pass the gate. The fix makes consumption a single atomic compare-and-set and rewires the endpoint to consume-first, then proves single-use with deterministic regression tests. This is a code fix + tests only (no schema/type/CI changes), executing an already-recommended remedy (archive impl-review **F5**).

## Current State Analysis

- **The race site**: `src/pages/api/account/deletion/execute.ts:35` (read) → `:53` (`markTokenUsed`, non-atomic burn) → `:55` (`deleteUser`). The window between read and burn spans `getUserById` + `recordDeletionEvent`. Two concurrent POSTs both pass `:35`, both write an audit row, both burn, both call `deleteUser` (second is a no-op; cost today is a duplicate audit row).
- **The burn** (`src/lib/services/account-deletion.ts:85-91`): `markTokenUsed` does `.update({ used_at }).eq("token_hash", h)` — no `used_at IS NULL` predicate, no affected-row check, returns `void`. Cannot detect a concurrent burn.
- **The read gate must stay read-only**: `src/pages/account/delete/confirm.astro:21` calls `findValidDeletionToken` to render confirmation-page state (`confirm.astro:6`: "READ-ONLY — it never deletes"). The fix must NOT change `findValidDeletionToken`'s semantics.
- **Atomicity is available with one statement**: a conditional `UPDATE ... SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING *` is race-free under Postgres READ COMMITTED (Supabase default) via row-lock + EvalPlanQual re-check → exactly one winner, no explicit transaction needed.
- **No DB machinery needed**: `token_hash` is already the PK, so a partial unique index is inert against a repeated UPDATE of the same row; an RPC/SECURITY DEFINER function would introduce a pattern the repo does not use (zero `CREATE FUNCTION` in migrations, zero `.rpc(` in `src/`). Pure service-layer change; no migration, no `src/types.ts` regeneration.
- **The idiom already exists**: `.update(...).is("used_at", null).select()` + treating an empty result as zero-rows mirrors `plans.ts:55` (`.select().single()`) and the RLS no-op checks in `gear-flow.test.ts:491,495` / `rls-ownership.test.ts:181`.

## Desired End State

Consuming a deletion token is atomic: exactly one caller can burn a given token, enforced by the DB at write time. `execute.ts` uses the atomic consume as its sole authoritative gate (burn → audit → delete). `findValidDeletionToken` remains a non-consuming read for the confirm page. A new integration test proves single-use both sequentially (isolated from the row-absence confound) and under concurrency (exactly one winner), and a deliberate-break check confirms the tests bind to the `used_at` predicate. The test-plan §6.6 note records the defect as fixed.

Verify: `npx vitest run tests/integration` green; the new consume test fails if `.is("used_at", null)` is removed; `npm run lint` clean.

### Key Discoveries:

- `src/lib/services/account-deletion.ts:69-80` (`findValidDeletionToken`, keep read-only), `:85-91` (`markTokenUsed`, the non-atomic burn).
- `src/pages/api/account/deletion/execute.ts:34-59` — the consume sequence to rewire.
- `src/pages/account/delete/confirm.astro:21` — read-only consumer that must not break.
- `src/types.ts:185,199` — `AccountDeletionToken` Row + `AccountDeletionTokenUpdate` (only `used_at`/`requested_ip`/`expires_at` updatable); a consume function returns `AccountDeletionToken`.
- Archive impl-review **F5** (`context/archive/2026-06-19-account-deletion/reviews/impl-review.md:81`) pre-specifies this exact fix.

## What We're NOT Doing

- **No DB migration, no partial unique index, no RPC/SECURITY DEFINER function** — the single conditional UPDATE is sufficient and minimal (see Current State Analysis).
- **No `src/types.ts` regeneration** — no schema change.
- **No change to `findValidDeletionToken`'s read-only semantics** — the confirm page depends on it.
- **No refactor of the existing `account-deletion-execute.test.ts` service-sequence tests** to mirror the new endpoint order — they still validate the underlying service functions; keeping them avoids scope creep. (`markTokenUsed` is retained as a lower-level helper used by the Phase-3 isolated single-use test.)
- **No widening to the fresh-OTP gate, execute's no-session posture, or the throttle** — this change is the single-use race only.
- **No new CI wiring** — Vitest-in-CI remains a separate concern.

## Implementation Approach

Add `consumeDeletionToken(admin, rawToken): Promise<AccountDeletionToken | null>` performing the atomic burn-and-return, then make it the sole gate in `execute.ts`: parse token → `consumeDeletionToken` (null → redirect to confirm) → fetch email + write audit → `deleteUser` → sign out + redirect. This removes the read/burn split entirely and, as a side benefit, eliminates the duplicate-audit-row cost (a losing concurrent caller matches zero rows and aborts before writing any audit). The audit write moves to after the atomic burn (trace-before-delete still holds). Tests are deterministic because the fix guarantees exactly one winner.

## Critical Implementation Details

- **Consume-first ordering / audit tradeoff.** The winner burns atomically, then writes the audit row, then deletes. Trace-before-delete still holds and the orphan-audit-row cost disappears. The accepted residual: a crash between the winning burn and the audit write leaves a spent token with no trace and no retry — strictly rarer than today's mid-op window and deemed acceptable.
- **The `used_at IS NULL` predicate is load-bearing**; `expires_at > now()` is belt-and-suspenders that folds validity into the same atomic step. Use `.maybeSingle()` so a zero-row result returns `null` rather than throwing.

## Phase 1: Atomic Consume — Service + Endpoint

### Overview

Add the atomic consume function and rewire the execute endpoint to use it as the sole gate, consume-first.

### Changes Required:

#### 1. Atomic consume function

**File**: `src/lib/services/account-deletion.ts`

**Intent**: Add `consumeDeletionToken` that atomically burns a valid token and returns its row (or null if already used / expired / absent), closing the read-then-burn window. Keep `findValidDeletionToken` and `markTokenUsed` unchanged (read gate for the confirm page; lower-level helper for the isolated single-use test).

**Contract**: `consumeDeletionToken(admin: Admin, rawToken: string): Promise<AccountDeletionToken | null>`. Hash the raw token, then `.from("account_deletion_tokens").update({ used_at: <now ISO> }).eq("token_hash", hash).is("used_at", null).gt("expires_at", <now ISO>).select().maybeSingle()`; throw on a real error, return `data` (the burned row, or `null` when zero rows matched). Add a header comment noting it is the atomic single-use gate and why the predicate is load-bearing.

#### 2. Rewire the execute endpoint to consume-first

**File**: `src/pages/api/account/deletion/execute.ts`

**Intent**: Replace the `findValidDeletionToken` read + `markTokenUsed` burn with a single `consumeDeletionToken` call as the authoritative gate, preserving the existing redirect/error behavior. Order becomes: parse token → consume (null → redirect to confirm with the token echoed) → fetch email + `recordDeletionEvent` → `deleteUser` → sign out + redirect to done.

**Contract**: The empty-token guard and the invalid/expired/used redirect to `/account/delete/confirm?token=...` are unchanged in behavior; only the gate mechanism changes. `markTokenUsed` import is removed from this file. Audit row is written after the burn, before the delete. `deleteUser` failure still returns the generic 500; the surrounding `try/catch` mapping is retained.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes (changed files): `npm run lint` (type-checked ESLint) and `npx astro sync && npx tsc --noEmit` (no NEW errors in changed files)
- [ ] Linting passes: `npm run lint`
- [ ] Full integration suite still green: `npx vitest run tests/integration`

#### Manual Verification:

- [ ] `execute.ts` order is consume → audit → delete, and no longer imports/uses `markTokenUsed`
- [ ] `findValidDeletionToken` is unchanged and `confirm.astro` still renders valid/invalid state correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Regression Tests + Close-Out

### Overview

Prove single-use deterministically (sequential + concurrent) in a dedicated test file, verify via a deliberate break, and mark the deferred defect fixed in the test plan.

### Changes Required:

#### 1. Deterministic consume regression tests

**File**: `tests/integration/account-deletion-consume.test.ts` (new)

**Intent**: Prove the atomic single-use guarantee. A sequential test that consumes a token once (wins, returns row) then again (loses, returns null) with the token row still present and `used_at` unchanged — so the rejection is provably the `used_at` guard, not row-absence. A concurrent test firing two consumes via `Promise.all` asserting exactly one non-null winner.

**Contract**: New file reusing the account-deletion harness verbatim (`assertLocal`, service-role `admin` client with `DEFAULT_URL`/`DEFAULT_SERVICE_ROLE_KEY` + env overrides, `Date.now()`-suffixed emails, dedicated user per describe, `afterAll` `deleteUser`). Sequential assertions: `first` non-null with `first.user_id === userId`; `second` is null; re-select the row → length 1 and `used_at === first.used_at` (unchanged); `findValidDeletionToken` now null; `getUserById(userId)` still present. Concurrent assertion: exactly one of the two `Promise.all` results is non-null. No `deleteUser` between consumes (avoids the cascade confound).

#### 2. Mark the deferred defect fixed in the test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Update the §6.6 Phase-3 note's "Deferred defect — TOCTOU single-use race" entry to record that it is now fixed by this change, with the fix summary (atomic compare-and-set) and a pointer to `context/changes/fix-account-deletion-token-toctou/`.

**Contract**: Edit the §6.6 note (append a "Resolved 2026-07-02" line or equivalent); keep the historical description. No other test-plan sections change.

### Success Criteria:

#### Automated Verification:

- [ ] New consume tests pass: `npx vitest run tests/integration/account-deletion-consume.test.ts`
- [ ] Full integration suite green: `npx vitest run tests/integration`
- [ ] Linting passes: `npm run lint`
- [ ] Prettier passes on edited markdown: `npx prettier --check context/foundation/test-plan.md`

#### Manual Verification:

- [ ] Deliberate-break: removing `.is("used_at", null)` from `consumeDeletionToken` makes the sequential test fail (`second` non-null / `used_at` changed) AND the concurrent test fail (two winners); then reverted
- [ ] Sequential test proves rejection via `used_at` unchanged + row present (not row-absence)
- [ ] §6.6 note reads as resolved (fixed vs still-deferred distinguishable) and links this change

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- None — the behavior is a DB-atomicity guarantee, only observable against real Postgres.

### Integration Tests:

- Sequential single-use isolation (consume twice; second rejected by `used_at`, row present, timestamp unchanged).
- Concurrent one-winner (`Promise.all` of two consumes → exactly one non-null).

### Manual Testing Steps:

1. `npx supabase start` so local Supabase is running.
2. `npx vitest run tests/integration/account-deletion-consume.test.ts` — confirm green.
3. Deliberate break: drop `.is("used_at", null)` in `consumeDeletionToken`; re-run — sequential and concurrent tests fail; revert and confirm green.
4. `npx vitest run tests/integration` — full suite green (existing account-deletion tests unaffected).

## Performance Considerations

Negligible — one conditional UPDATE replaces a SELECT + UPDATE (fewer round trips). `fileParallelism: false` keeps integration runs serial.

## Migration Notes

None — no schema, type, or data changes. Rollback is a pure code revert.

## References

- Research: `context/changes/fix-account-deletion-token-toctou/research.md`
- Change identity: `context/changes/fix-account-deletion-token-toctou/change.md`
- Origin defect: `context/archive/2026-06-19-account-deletion/reviews/impl-review.md:74-82` (F5) and `:81` (fix pre-specified)
- Deferred-defect record: `context/foundation/test-plan.md` §6.6
- Idiom references: `src/lib/services/plans.ts:55`; `tests/integration/gear-flow.test.ts:491,495`
- Harness references: `tests/integration/account-deletion-execute.test.ts`, `tests/integration/account-deletion-tokens.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Atomic Consume — Service + Endpoint

#### Automated

- [x] 1.1 Type checking passes for changed files (`npm run lint` + `npx astro sync && npx tsc --noEmit`, no new errors) — 59dcd5b
- [x] 1.2 Linting passes: `npm run lint` — 59dcd5b
- [x] 1.3 Full integration suite still green: `npx vitest run tests/integration` — 59dcd5b

#### Manual

- [x] 1.4 `execute.ts` order is consume → audit → delete; no `markTokenUsed` import/use — 59dcd5b
- [x] 1.5 `findValidDeletionToken` unchanged; `confirm.astro` still renders valid/invalid state — 59dcd5b

### Phase 2: Regression Tests + Close-Out

#### Automated

- [x] 2.1 New consume tests pass: `npx vitest run tests/integration/account-deletion-consume.test.ts`
- [x] 2.2 Full integration suite green: `npx vitest run tests/integration`
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Prettier passes on edited markdown: `npx prettier --check context/foundation/test-plan.md`

#### Manual

- [x] 2.5 Deliberate-break makes both sequential and concurrent tests fail, then reverted
- [x] 2.6 Sequential test proves rejection via `used_at` unchanged + row present (not row-absence)
- [x] 2.7 §6.6 note reads as resolved and links this change

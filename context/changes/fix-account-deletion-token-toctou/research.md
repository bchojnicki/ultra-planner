---
date: 2026-07-02T16:25:03+02:00
researcher: Claude (Opus 4.8)
git_commit: b43ec24080d54ad3c27d536cd5b4914c51939c41
branch: main
repository: ultra-planner
topic: "Fix the TOCTOU single-use race in account-deletion token consumption: exact concurrency surface, the correct atomic fix, and the cheapest deterministic test"
tags: [research, codebase, account-deletion, security, toctou, concurrency, single-use, supabase, postgres]
status: complete
last_updated: 2026-07-02
last_updated_by: Claude (Opus 4.8)
---

# Research: TOCTOU single-use race in account-deletion token consumption

**Date**: 2026-07-02T16:25:03+02:00
**Researcher**: Claude (Opus 4.8)
**Git Commit**: b43ec24 (working tree dirty: pre-existing unrelated paths only)
**Branch**: main
**Repository**: ultra-planner

## Research Question

Ground the fix for the deferred defect surfaced by rollout Phase 3 (`testing-authorization-account-deletion-safety`): `markTokenUsed` (`src/lib/services/account-deletion.ts:85-91`) is a non-atomic bare `UPDATE ... SET used_at = now()` with no `used_at IS NULL` compare-and-set. The consume path reads (`findValidDeletionToken`) and burns (`markTokenUsed`) in two separate statements, so two concurrent `execute` requests carrying the same raw token can both pass the read gate — a TOCTOU single-use race on the irreversible account-deletion endpoint. Confirm the exact concurrency surface, the correct/minimal atomic fix, and the cheapest **deterministic** regression test. **Scope: the race only** (tight — per `change.md`).

## Summary

**The fix is small, race-free, and needs no migration.** Replace the check-then-act consume path with a single atomic compare-and-set: `UPDATE account_deletion_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING *`. Under Postgres default READ COMMITTED (Supabase's default), a single conditional UPDATE takes a row lock and, via the EvalPlanQual re-check, re-evaluates its `WHERE` against the winner's committed row — so of two concurrent executions **exactly one** gets a row back and the loser matches zero rows. This is genuinely atomic without an explicit transaction, `SELECT ... FOR UPDATE`, serializable isolation, or an RPC.

Three corrections/confirmations to the `change.md` fix-intent notes:
1. **The "partial unique index on unused tokens" idea does NOT fix this race** — `token_hash` is already the PK, and a unique index governs distinctness *across rows*, not repeated UPDATEs of the *same* row. It would sit inert. Drop it from the plan.
2. **A SECURITY DEFINER RPC is correct but superfluous** and would introduce a pattern the repo does not use anywhere (zero `CREATE FUNCTION` in `supabase/migrations/`, zero `.rpc(` call sites in `src/`). Skip it.
3. **No DB migration and no `src/types.ts` regeneration are required** — the conditional UPDATE touches only existing columns via the existing service-role admin client; a `RETURNING`/`.select()` variant changes neither schema nor generated types.

**Shape of the change:** add a new `consumeDeletionToken(admin, rawToken): Promise<AccountDeletionToken | null>` (atomic burn-and-return) and make it the **authoritative gate** in `execute.ts`. Keep `findValidDeletionToken` **read-only and unchanged** — the confirm page (`confirm.astro:21`) and the execute pre-check both depend on a non-consuming read. The `.update(...).is("used_at", null).select()` + empty-result idiom is already used elsewhere in the repo, so the fix follows an established pattern.

**Test:** the fix converts an untestable race into deterministic assertions. Ship a **sequential** regression test (consume once → wins; consume the same raw token again → `null`, with the row still present and `used_at` unchanged — proving the rejection is the `used_at` guard, not row-absence) **plus** a **concurrent** `Promise.all` test (assert exactly one non-null winner — deterministic after the fix because Postgres guarantees one winner). A deliberate-break check (drop `.is("used_at", null)`) fails both, confirming they bind to the compare-and-set.

**History:** this race was not overlooked — it was explicitly logged and deferred in the original change as impl-review finding **F5** ("SKIPPED — accepted as MVP; idempotent delete, worst case a duplicate audit row"), and the compare-and-set fix was pre-specified there verbatim. This follow-up is executing an already-recommended fix.

## Detailed Findings

### The concurrency surface (the exact TOCTOU site)

`src/pages/api/account/deletion/execute.ts` POST handler runs the consume sequence:
- `:35` `findValidDeletionToken(admin, token)` — **READ** gate (hash + `used_at IS NULL` + `expires_at > now()`).
- `:43-45` `getUserById` + `sha256Hex(email)` — fetch email for the audit row.
- `:47-51` `recordDeletionEvent` — **audit row written**.
- `:53` `markTokenUsed(admin, row.token_hash)` — **BURN** (non-atomic bare UPDATE).
- `:55` `admin.auth.admin.deleteUser(row.user_id)` — HARD delete (cascades all data, incl. the token row via FK).

The window between the read (`:35`) and the burn (`:53`) spans several awaited calls. Two concurrent POSTs of the same raw token both pass `:35`, both write an audit row, both burn, both call `deleteUser`. Today's cost is bounded (the second `deleteUser` is a no-op; a duplicate audit row) — but it is a real single-use violation on an irreversible endpoint.

The burn itself (`src/lib/services/account-deletion.ts:85-91`):
```
markTokenUsed(admin, tokenHash): Promise<void>
  .update({ used_at: now }).eq("token_hash", tokenHash)   // no .is("used_at", null), no .select(), returns void
```
It cannot detect that another caller already burned the token — no affected-row check.

**Only production burn site is `execute.ts:53`.** `confirm.astro:21` calls `findValidDeletionToken` **read-only** (header comment `confirm.astro:6`: "READ-ONLY — it never deletes"; maps `row ? "valid" : "invalid"`). This is the load-bearing constraint on the fix: **`findValidDeletionToken` must stay non-consuming.**

Current service signatures (`src/lib/services/account-deletion.ts`):
- `findValidDeletionToken(admin, rawToken): Promise<AccountDeletionToken | null>` (`:69`) — read gate, `.maybeSingle()`.
- `markTokenUsed(admin, tokenHash): Promise<void>` (`:85`) — non-atomic burn.
- `hasActiveDeletionToken` (`:36`), `issueDeletionToken` (`:50`) — unaffected.

### The correct atomic fix (compare-and-set, single conditional UPDATE)

`UPDATE account_deletion_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING *`

Why it is race-free under READ COMMITTED (no explicit transaction needed):
1. A single UPDATE is its own implicit transaction; Postgres serializes concurrent writers to the same row via row locks.
2. Both statements match `token_hash` (PK lookup) and initially see `used_at IS NULL`; both try to lock the row.
3. One wins the lock, sets `used_at`, commits, releases.
4. The other unblocks and runs the **EvalPlanQual re-check** — it re-reads the now-updated row and re-evaluates the `WHERE`; `used_at` is no longer NULL → predicate fails → the row is excluded.

Result: the winner's `RETURNING` yields one row; the loser's yields **zero**. The caller distinguishes winner from loser purely by whether a row came back. The `used_at IS NULL` clause is the load-bearing predicate; `expires_at > now()` is belt-and-suspenders that folds the validity check into the same atomic step (an expired token can never be burned).

supabase-js form (service-role admin client, RLS bypassed):
```
.from("account_deletion_tokens")
  .update({ used_at: new Date().toISOString() })
  .eq("token_hash", hash)
  .is("used_at", null)
  .select()
  .maybeSingle()          // → AccountDeletionToken when it wins, null when already-used/absent
```

This idiom (`.update(...).select()` and treating empty as zero-rows) already exists in the repo:
- Zero-row detection: `tests/integration/rls-ownership.test.ts:181`, `tests/integration/gear-flow.test.ts:491,495` (`expect(data).toEqual([])`).
- Exactly-one via `.single()`: `src/lib/services/plans.ts:55`, `aid-stations.ts:27`, `gear-items.ts:27`.

### Fixes considered and rejected

- **Partial unique index `(token_hash) WHERE used_at IS NULL`** — does NOT address this race. Uniqueness constrains *distinct rows*; the double-consume is two UPDATEs of the *same* existing row (one physical row per `token_hash`, already guaranteed by the PK). The index would be inert during the race and redundant with the PK. **Remove from the plan.**
- **SECURITY DEFINER RPC (`SELECT ... FOR UPDATE` then UPDATE)** — correct but buys nothing over the single conditional UPDATE, and introduces a brand-new pattern: zero Postgres functions in `supabase/migrations/`, zero `.rpc(` calls in `src/`. Extra migration + security-definer review (search_path, grants) + wiring, no correctness gain. **Skip.**

### Migration & types

- **No migration.** Pure service-layer change touching only existing columns (`used_at`, `token_hash`, `expires_at`) through the existing admin client. `supabase/migrations/` unchanged. (Migration naming convention, moot here: `YYYYMMDDHHmmss_desc.sql`.)
- **No `src/types.ts` regeneration.** Generated `Database` types describe the schema, not query variants; a conditional UPDATE with `RETURNING` conforms to the existing `AccountDeletionTokenUpdate` payload and returns the existing `AccountDeletionToken` Row. Types: `AccountDeletionToken` (`src/types.ts:185`, all six fields), `AccountDeletionTokenUpdate` (`:199`, only `used_at`/`requested_ip`/`expires_at` updatable), registered in `Database` (`:314-317`).

### The cheapest deterministic test

The Phase 3 "flaky against local Supabase" verdict applied to the **broken** check-then-act code (both could pass). After the atomic fix the outcome is **deterministic**, so both of these are stable:

**1. Sequential regression (primary, order-independent, kills the row-absence confound):**
- `issueDeletionToken` → `findValidDeletionToken` resolves (read path intact).
- `consumeDeletionToken` #1 → returns the row, `used_at` set (capture `burnedAt`).
- `consumeDeletionToken` #2 (same raw) → `null`.
- Prove the rejection is the guard, not row-absence: re-select the row → `toHaveLength(1)` and `used_at === burnedAt` (a non-atomic overwrite would change the timestamp).
- `findValidDeletionToken` now returns `null`; `getUserById(userId)` still returns the user (no `deleteUser`, so no cascade confound — the exact confound the Phase 3 isolated single-use test called out).

**2. Concurrent (`Promise.all` of two consumes) → assert exactly one non-null winner.** Deterministic and non-flaky after the fix (Postgres guarantees one winner). It is the only test that directly characterizes the property the fix exists for; it would fail against the old non-atomic code (length 2). Include it, sequential first.

**Deliberate-break check (feasible):** revert the `.is("used_at", null)` predicate → sequential fails at `second === null` and `used_at === burnedAt`; concurrent fails at `winners.length === 1` (both return rows). Confirms the tests bind to the compare-and-set, not row-presence.

Harness to reuse (verbatim from the two existing account-deletion tests): `assertLocal(SUPABASE_URL)` (respects `ALLOW_REMOTE_DELETION_TEST=1`), service-role `admin` client with `DEFAULT_URL`/`DEFAULT_SERVICE_ROLE_KEY` + `process.env` overrides, `Date.now()`-suffixed emails, dedicated user per describe, `afterAll` `deleteUser` (token row cascades away — no manual token cleanup; the test writes no audit rows). `vitest.config.ts` already sets `fileParallelism: false` and 30s timeouts; place at `tests/integration/account-deletion-consume.test.ts` (or extend `account-deletion-execute.test.ts`). No config change.

## Code References

- `src/pages/api/account/deletion/execute.ts:35,53` — the TOCTOU read (`findValidDeletionToken`) and burn (`markTokenUsed`) sites.
- `src/lib/services/account-deletion.ts:69-80` — `findValidDeletionToken` (keep read-only).
- `src/lib/services/account-deletion.ts:85-91` — `markTokenUsed` non-atomic burn (the defect).
- `src/pages/account/delete/confirm.astro:6,21` — read-only consumer of `findValidDeletionToken` (must not break).
- `supabase/migrations/20260619120000_create_account_deletion_tokens.sql:16-27` — table: `token_hash` PK, `used_at` nullable, `expires_at not null`, RLS-enabled/zero-policy; no single-use DB guard.
- `src/types.ts:185,199,314-317` — `AccountDeletionToken` Row / Update / `Database` registration.
- `src/lib/services/plans.ts:55` (and `aid-stations.ts:27`, `gear-items.ts:27`) — `.update(...).select().single()` return idiom.
- `tests/integration/gear-flow.test.ts:491,495`, `tests/integration/rls-ownership.test.ts:181` — `.update(...).select()` → `data === []` zero-row idiom.
- `tests/integration/account-deletion-execute.test.ts:168-193` — isolated single-use pattern to mirror; `:99-124` execute sequence + cascade-confounded replay.
- `tests/integration/account-deletion-tokens.test.ts:136-148` — back-dating / positive-control pattern.

## Architecture Insights

- **Single-use is enforced at read time today, not atomically at write time.** Sequential replay is blocked by three overlapping mechanisms (the `used_at` read filter, the FK cascade self-cleaning the row on success, the 30-min expiry); concurrent replay is not. The compare-and-set moves enforcement to the write, closing the window while leaving the read path (confirm page) untouched.
- **The atomic-burn shape lets the execute path collapse read+burn into one authoritative gate.** Making `consumeDeletionToken` the gate (rather than the earlier `findValidDeletionToken` read) also means a losing concurrent caller aborts *before* writing an audit row — which incidentally eliminates the "duplicate audit row" cost the original change accepted under F5. This interacts with audit ordering (see Open Questions).
- **The repo deliberately keeps the token surface tiny and service-role-only.** No RLS policies, no RPC, no Postgres functions — so the correct fix stays within the existing service + admin-client pattern rather than adding DB machinery.

## Historical Context (from prior changes)

- `context/archive/2026-06-19-account-deletion/reviews/impl-review.md:74-82` — **F5** "Token consume is not atomic (theoretical double-execute race)", OBSERVATION/LOW, location `execute.ts:33,49`. Detail: "Two concurrent POSTs ... could both pass findValidDeletionToken before either marks used → two deleteUser calls + two audit rows. Second delete is a harmless no-op; only cost is a duplicate audit row." **Decision: "SKIPPED — accepted as MVP."** The race was contemplated and deferred, not missed.
- `context/archive/2026-06-19-account-deletion/reviews/impl-review.md:81` — the fix is pre-specified: **"Conditional `update … where used_at is null` and check affected rows to make consumption atomic."** This research confirms that recommendation is correct and minimal.
- `context/archive/2026-06-19-account-deletion/plan.md:177-179` — the original execute contract: read unused/unexpired row, then audit → mark used → delete, with mark-used-before-delete for idempotency and audit-before-delete for a trace. Single-use leaned on the `used_at` filter + FK cascade + expiry, never a compare-and-set. F2 (`reviews/impl-review.md:35-51`) notes "concurrent double-submit becomes dominant if reordered."
- No "single-user MVP" framing exists; the only scope-limiting statements are the F4/F5 "accepted as MVP" review decisions.

## Related Research

- `context/changes/testing-authorization-account-deletion-safety/research.md` — Phase 3 research that surfaced this defect (§Risk #3 gap 3, "TOCTOU single-use race") and deferred it.
- `context/foundation/test-plan.md` §6.6 — Phase-3 note recording the deferred defect and pointing here.
- `context/archive/2026-06-19-account-deletion/` — original account-deletion change (frame/plan/research/review) that built this token model.

## Open Questions

1. **Function shape (for `/10x-plan` to decide):** add a new `consumeDeletionToken` and make it the sole gate in `execute.ts` (recommended — cleanest, removes the TOCTOU and the orphan-audit cost), vs. keep `findValidDeletionToken` + convert `markTokenUsed` to a boolean compare-and-set checked before delete. The isolated single-use test (`execute.test.ts:174`) currently calls `markTokenUsed` directly — decide whether to keep `markTokenUsed` as a lower-level helper or migrate those callers.
2. **Audit-row ordering tradeoff (intrinsic to where the atomic burn sits):** consume-first ordering moves the audit write to *after* the burn. Trace-before-delete still holds, and the loser no longer writes an orphan audit row — but a process crash between the winning burn and the audit write would leave a burned token with no trace and no delete (the user cannot retry, since the token is spent). Confirm this is acceptable (it is strictly rarer than today's mid-op failure window) or add a compensating measure. This is the one design decision the tight-scope fix cannot avoid.
3. **Test placement:** new `tests/integration/account-deletion-consume.test.ts` vs. extending `account-deletion-execute.test.ts`. Both fit the harness; a dedicated file gives clearer provenance for the concurrent test.

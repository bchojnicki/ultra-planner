---
date: 2026-07-02T15:30:00+02:00
researcher: Claude (Opus 4.8)
git_commit: 66aa07b299f4ef170636cda7cf9710eb5f9e3f00
branch: main
repository: ultra-planner
topic: "Rollout Phase 3 — Authorization (IDOR, Risk #4) & account-deletion token safety (Risk #3): what is already covered and what is the true net-new gap"
tags: [research, codebase, authorization, rls, idor, account-deletion, security, testing]
status: complete
last_updated: 2026-07-02
last_updated_by: Claude (Opus 4.8)
---

# Research: Authorization (Risk #4) & account-deletion token safety (Risk #3)

**Date**: 2026-07-02T15:30:00+02:00
**Researcher**: Claude (Opus 4.8)
**Git Commit**: 66aa07b (working tree dirty: uncommitted §3 status edits in `context/foundation/test-plan.md` + this change folder)
**Branch**: main
**Repository**: ultra-planner

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md` for **Risk #4** (a logged-in runner reaches/mutates another runner's plan/aid-station/gear via a route that checks "authenticated" but not "owner" — especially service-role admin-client routes that bypass RLS / IDOR) and **Risk #3** (the account-deletion confirmation token can be replayed, used after expiry, or used to delete the wrong account; the emailed link is not truly single-use, or the fresh-OTP re-auth gate is bypassable). Verify — not blindly accept — the response guidance; locate the real failure paths in code; identify the cheapest useful test layer; and flag what the **existing** suite already covers so the rollout closes a real gap rather than duplicating coverage.

## Summary

**No code-level IDOR defect was found (Risk #4), and the ownership guarantee is already well covered.** Every mutating/reading API route uses the request-scoped anon-key SSR client where Postgres RLS enforces ownership; the *only* service-role (RLS-bypassing) routes are the three self/token-scoped account-deletion endpoints — none takes an attacker-controllable resource id. The "service-role admin routes bypass RLS → IDOR" concern in the risk wording is **largely unfounded** as a code risk. Cross-user (two-user) RLS isolation is already proven at the DB/service layer for **all four** user tables: `plans` + `aid_stations` (`rls-ownership.test.ts`) and `gear_items` + `gear_segment_selections` (`gear-flow.test.ts`). The residual Risk #4 gap is narrow: cross-user **UPDATE/DELETE** on the two gear tables (only INSERT/SELECT are proven cross-user today), the `plan_id`-less gear-selection delete branch, and — only reachable via **e2e** — the route-layer HTTP error mapping (`PGRST116`→404, `42501`→403, 401 gating). Route handlers import `astro:env/server` and **cannot be imported under Vitest**, so any endpoint-level IDOR test is Playwright-only.

**For Risk #3, the account-deletion token model is sound, but two cheap service-layer gaps are genuinely net-new**, plus one real potential concurrency **defect**:
1. **Expiry is never enforced-tested on the consume path** — no test back-dates `expires_at` and asserts `findValidDeletionToken` returns `null`. **[net-new, service-testable, high value]**
2. **Single-use on the consume path is only tested *confounded* with the cascade** — the execute test's replay assertion runs *after* the user (and via cascade the token row) is deleted, so it never isolates the `used_at` guard. A clean "issue → `markTokenUsed` → `findValidDeletionToken` returns null (user still present)" is net-new. **[net-new, service-testable]**
3. **TOCTOU single-use race (potential defect):** `markTokenUsed` is a bare `UPDATE ... SET used_at=now()` with **no `used_at IS NULL` predicate and no affected-row check**, and the read (`findValidDeletionToken`) and burn (`markTokenUsed`) are two separate statements with no DB-level atomic guard (no partial unique index on unused tokens). Two concurrent executes of the same raw token can both pass the read gate. This is a code weakness, not just a coverage gap — **flag for backport/deferral**, not a flaky concurrency test in this rollout.

Sub-agent corrections worth calling out (this is why research is ground truth): the route-mapping agent reported `gear_items`/`gear_segment_selections` as having "zero coverage" — **false**, `gear-flow.test.ts` covers them cross-user. The token agent listed audit-row survival and actor-binding as "net-new" — audit survival is **already covered** by `account-deletion-execute.test.ts:118-121`, and actor-binding is **structural** (execute has no session; the token names its own owner), so "delete the wrong account" is structurally prevented rather than test-worthy.

## Detailed Findings

### The two Supabase clients (the crux of Risk #4)

- **`createClient(headers, cookies)`** — `src/lib/supabase.ts:6-25`. `createServerClient` with the **anon/publishable** key; wires the request cookies so every query runs as the authenticated user → **RLS enforces ownership**. App code never filters by `user_id`.
- **`createAdminClient()`** — `src/lib/supabaseAdmin.ts:16-24`. **service-role** key, no session → **RLS bypassed entirely**. Header (lines 5-11) flags it as the danger zone. Ownership on any path using it must be app-enforced.

**Every `supabaseAdmin` call site (4 total, all server-side, all self/token-scoped):**
- `src/pages/api/account/deletion/request.ts:25` — `hasActiveDeletionToken(admin, user.id)` (session `user.id` only).
- `src/pages/api/account/deletion/verify.ts:23` — `issueDeletionToken(admin, user.id, ...)` after OTP re-auth (session `user.id`).
- `src/pages/api/account/deletion/execute.ts:27` — consumes a validated single-use token; all ops keyed on `row.user_id` from the token hash, never from request input.
- `src/pages/account/delete/confirm.astro:13` — **read-only** state render.

**No route takes an attacker-controllable id and runs as admin without an ownership check.** The risk's "especially service-role routes that bypass RLS" framing does not match a real code surface here.

### Risk #4 — per-table cross-user coverage that ALREADY exists

| Table | Ownership model | Cross-user tests today | File |
|---|---|---|---|
| `plans` | direct `user_id = auth.uid()` | SELECT/UPDATE/DELETE no-op + INSERT `WITH CHECK`; owner CRUD | `tests/integration/rls-ownership.test.ts:144-236` |
| `aid_stations` | parent-plan subquery | SELECT/UPDATE/DELETE no-op + INSERT→42501; owner reads | `tests/integration/rls-ownership.test.ts:150-223` |
| `gear_items` | parent-plan subquery | INSERT→42501 (`:199-206`), SELECT hidden (`:208-221`); service `createGearItem(B, A.plan)`→42501 (`:325-329`) | `tests/integration/gear-flow.test.ts` |
| `gear_segment_selections` | parent-plan subquery (+ composite FK) | INSERT→42501 (`:240-245`) | `tests/integration/gear-flow.test.ts` |

RLS policy inventory (all `authenticated`-role, one policy per op, anon denied): `plans` direct `user_id = (select auth.uid())` (`supabase/migrations/20260603132423_create_plans_and_aid_stations.sql:82-98`); `aid_stations` (`:106-130`), `gear_items` (`20260616073640_create_gear_items.sql:50-74`), `gear_segment_selections` (`20260616073641_create_gear_segment_selections.sql:46-70`) all use `plan_id in (select id from plans where user_id = (select auth.uid()))`. A composite FK `(gear_item_id, plan_id) → gear_items(id, plan_id)` (`20260616073642_enforce_gear_selection_plan_consistency.sql:15-17`) structurally forbids a selection's `plan_id` disagreeing with its item's — closing a same-user cross-plan hole RLS alone missed.

**Residual Risk #4 gaps (net-new):**
1. Cross-user **UPDATE** and **DELETE** on `gear_items` and `gear_segment_selections` — only INSERT/SELECT are proven cross-user; the UPDATE/DELETE policies exist (same subquery) but are untested. **[service/DB-integration, cheap, extends `gear-flow.test.ts`]** — modest incremental signal (same proven pattern).
2. The `upsertGearSelection` **delete branch** (`src/lib/services/gear-selections.ts:35-39`) filters only `.eq("gear_item_id").eq("segment_index")` with **no `plan_id`** — it relies entirely on the RLS DELETE policy to scope a cross-user attempt to zero rows. Untested cross-user. **[service-integration, cheap]**
3. **Route-layer** authorization contracts — that the endpoint really binds the caller session and maps `PGRST116`→404 / `42501`→403 / missing session→401 for a *cross-user* caller. **[e2e / Playwright ONLY]** — route handlers import `astro:env/server` and are not Vitest-importable (see Test Infrastructure).

### Risk #3 — the token lifecycle, enforcement points, and gaps

Service module `src/lib/services/account-deletion.ts` imports **no** `astro:env` — every function takes an admin client and is **Vitest-importable**. `TOKEN_TTL_MINUTES = 30` (`:18`).

- `issueDeletionToken` (`:50-64`) — 32-byte CSPRNG raw token (`generateRawToken` `:21-25`), stores only `sha256Hex(raw)` (`:52`), `expires_at = now + 30min` (`:53`), `used_at` null. Returns raw (never persisted).
- `findValidDeletionToken` (`:69-80`) — the **consume-side read gate**: `.eq("token_hash").is("used_at", null).gt("expires_at", now).maybeSingle()`. Enforces single-use (read) + expiry in one query. Returns the row's `user_id`; does **not** compare against a session user (there is none at execute).
- `markTokenUsed` (`:85-91`) — **bare** `.update({ used_at: now }).eq("token_hash", hash)`. **No `used_at IS NULL` predicate, no affected-row check** → not a compare-and-set. This is the TOCTOU weakness.
- `recordDeletionEvent` (`:96-106`) — audit row (`user_id`, `email_hash`, `requested_ip`) into `account_deletion_events`; written before the delete.
- `hasActiveDeletionToken` (`:36-46`) — throttle predicate (429 gate) for the request endpoint only, **not** a consumption guard.

**Migrations:** `account_deletion_tokens` (`20260619120000...:*`) — PK is `token_hash text` (hash is the uniqueness key), `used_at timestamptz` nullable, `expires_at not null`, FK `user_id → auth.users on delete cascade`; **RLS enabled, zero policies** (service-role-only, `:27-28`); **no DB-level single-use guard** (no partial unique index / CHECK / trigger on `used_at`). `account_deletion_events` (`20260619120001...`) — RLS enabled, zero policies; deliberately **no FK** on `user_id` so the audit row **survives** the auth.users cascade.

**Fresh-OTP re-auth gate — server-side, but guards issuance only.** `request.ts:34-37` sends a fresh OTP (`signInWithOtp` on the session email); `verify.ts:31-38` is the real gate — `verifyOtp` on `context.locals.user.email` must pass before `issueDeletionToken` (`:44`) runs. The client body carries only `code`, so it can't be spoofed. **But `execute.ts` (the irreversible step) requires no session and no OTP** (comment `:15-17`) — the token is the sole credential by design. So freshness protects minting, not the destructive delete; only the 30-min TTL + single-use protect execute.

**Existing Risk #3 coverage:**
- `account-deletion-tokens.test.ts` — issuance = one hashed ~30-min unused row (`:69-92`); throttle predicate false→true (`:65,94`); a **manually** `used_at`-stamped token drops from `hasActiveDeletionToken` (`:98-105`, throttle path, **not** the consume path).
- `account-deletion-execute.test.ts` — full service sequence issue→`findValidDeletionToken`→`recordDeletionEvent`→`markTokenUsed`→`deleteUser`; cascade removal of plans/aid_stations/gear_items (`:114-116`); **one surviving audit row** (`:118-121`); replay: `findValidDeletionToken(raw)` returns null (`:124`) — **but after both `markTokenUsed` AND the cascade delete**, so it does not isolate the `used_at` guard.
- `account-deletion-cascade.test.ts` — service-role `deleteUser` cascades.

**Net-new Risk #3 targets (after removing already-covered items):**
1. **Expiry enforcement on consume** — issue, back-date `expires_at` into the past (admin update), assert `findValidDeletionToken` → `null`. Not tested anywhere. **[service-testable, high value — directly the "used after expiry" concern]**
2. **Single-use on consume, isolated** — issue, `markTokenUsed(hash)`, then `findValidDeletionToken` → `null` **with the user still present** (no cascade confound). **[service-testable]**
3. **TOCTOU concurrent double-consume** — a real code weakness (see above). A characterization test would *document a race that currently both-passes*, and is inherently flaky against local Supabase. **Recommend flagging as a finding / deferred fix (compare-and-set: `.update({used_at}).is("used_at", null)` + affected-row check, or a partial unique index), NOT a rollout test.**

**NOT net-new (do not re-test):** audit-row survival (covered `execute.test.ts:118-121`); actor-binding "A's token can't delete B" (structural — execute has no session, token names its own `user_id`; at most add a one-line B-untouched assertion for defense-in-depth, low value); the fresh-OTP gate and execute's no-session posture (**e2e/manual only** — `verify.ts`/`execute.ts` import `astro:env`).

### Test infrastructure (decides the cheapest layer)

- `vitest.config.ts:14-19` — `environment: node`, `include: ["tests/integration/**/*.test.ts","tests/unit/**/*.test.ts"]`, `fileParallelism: false` (stateful user create/delete), 30s hook/test timeouts. Playwright `*.spec.ts` excluded.
- `package.json:13` — only `"test:integration": "vitest run"`; integration tests assume a **locally running** Supabase (`npx supabase start` + `db reset`); no global-setup boots it.
- **No integration test imports a route handler.** Grep for `src/pages/api/**` / `astro:env` imports under `tests/integration/` → zero. Every test drives services or the DB directly. Endpoints import `astro:env/server` (via the supabase clients + `email.ts`), so importing them under Vitest is not possible without module mocking or real HTTP. **Route-level IDOR / fresh-OTP / execute-posture ⇒ Playwright e2e.**
- Shared harness pattern to reuse: inline `assertLocal(url)` localhost guard (override `ALLOW_REMOTE_RLS_TEST=1` for RLS tests, `ALLOW_REMOTE_DELETION_TEST=1` for deletion tests), duplicated `DEFAULT_URL`/`DEFAULT_ANON_KEY`/`DEFAULT_SERVICE_ROLE_KEY` CLI demo creds, `anonClient()` + `signInWithPassword` per runner, service-role `admin` for user create/delete, `Date.now()`-stamped emails, password `test-password-123!`.

## Code References

- `src/lib/supabase.ts:6-25` — anon SSR client (RLS applies).
- `src/lib/supabaseAdmin.ts:16-24` — service-role client (RLS bypassed); 4 call sites, all self/token-scoped.
- `src/pages/api/account/deletion/{request,verify,execute}.ts` — the only admin-client routes; fresh-OTP gate at `verify.ts:31-38`; execute has no session (`execute.ts:15-17`).
- `src/lib/services/account-deletion.ts:69-80` (consume read gate), `:85-91` (non-atomic `markTokenUsed` — TOCTOU), `:36-46` (throttle only).
- `src/lib/services/gear-selections.ts:35-39` — `plan_id`-less delete branch (RLS-reliant, untested cross-user).
- `supabase/migrations/20260619120000_create_account_deletion_tokens.sql` — token table, RLS-enabled/zero-policy, no DB single-use guard.
- `supabase/migrations/20260616073642_enforce_gear_selection_plan_consistency.sql:15-17` — composite FK cross-plan guard.
- `tests/integration/rls-ownership.test.ts` — plans + aid_stations cross-user (DB-level).
- `tests/integration/gear-flow.test.ts:140-252,254-394` — gear_items + gear_segment_selections cross-user (INSERT/SELECT) + service ownership.
- `tests/integration/account-deletion-execute.test.ts:95-130` — issue→execute sequence, cascade, surviving audit row, replay-null (cascade-confounded).
- `tests/integration/account-deletion-tokens.test.ts:65-105` — issuance, throttle, manually-used drops from throttle.

## Architecture Insights

- **RLS is the real ownership guard**, uniformly: one policy per operation, `authenticated`-only, direct `user_id` on `plans` and a parent-plan subquery on the three child tables. App/service code deliberately never filters by `user_id` — it trusts RLS. This is why the cheapest ownership test layer is a two-user anon-client integration test hitting the DB/services, exactly as the existing suite does.
- **The service-role surface is deliberately tiny and self-scoped.** Only account-deletion touches it, and the token — not request input — names the victim account, so cross-user deletion is structurally impossible.
- **Single-use is enforced at read time, not atomically at write time.** Sequential replay is blocked (read gate + burn-before-delete + cascade); concurrent replay is not (no compare-and-set, no DB partial-unique on unused tokens). This is the one genuine security weakness surfaced.
- **The astro:env boundary splits the test pyramid cleanly:** service/DB logic = Vitest integration (cheap, deterministic); HTTP/route/session/OTP wiring = Playwright e2e (or manual). The team has already drawn this line consistently in every integration-test header.

## Backport corrections for `/10x-test-plan` (§2 / §3 — orchestrator's call, no file anchors added)

Research recommends the orchestrator consider these edits to `context/foundation/test-plan.md` §2/§3 (this skill does not edit §1/§2):
1. **Risk #4 wording** — "especially routes using the service-role admin client that bypass RLS" overstates the code surface: the only admin-client routes are self/token-scoped account-deletion, with no attacker-controllable id. Reframe toward "the ownership guarantee is proven cross-user at the DB/service layer for all four tables; the untested residue is gear UPDATE/DELETE cross-user and the endpoint HTTP layer (e2e-only)."
2. **Risk #4 cheapest-layer** — §2 says "extend `rls-ownership.test.ts`"; most of that matrix already exists (incl. `gear-flow.test.ts`). Net-new integration work is small; true route-level coverage is **e2e**, not integration — the §3 Phase-3 "integration" test-type should acknowledge an e2e slice or descope the route layer.
3. **Risk #3** — narrow to the two net-new **consume-path** service tests (expiry, isolated single-use); mark audit-survival and actor-binding as already-covered/structural; record the **TOCTOU single-use race** as a deferred potential defect (a fix, not a rollout test).

## Related Research

- `context/changes/testing-input-pipeline-integrity/research.md` — prior Phase 2 research (also flagged already-covered persistence to avoid duplication).
- `context/archive/2026-06-19-account-deletion/` — original account-deletion change (frame/plan/research) that built this token model.
- `context/archive/2026-06-03-plan-data-and-ownership/` — the RLS ownership model origin.

## Open Questions

1. **TOCTOU fix vs. accept:** does the plan add a characterization test (flaky) for the concurrent double-consume, flag it as a deferred defect (recommended), or fix `markTokenUsed` to a compare-and-set in this change? The rollout is test-only by charter, so a fix likely belongs to a separate `/10x-new` change.
2. **e2e appetite for Risk #4/#3 route layer:** the highest-fidelity IDOR + fresh-OTP + execute-no-session proofs are Playwright-only. Is a small e2e slice in scope for this rollout, or does the plan stay integration-only and explicitly defer the endpoint layer (matching every existing test header's "verified manually / Playwright" note)?
3. **Value of completing the gear UPDATE/DELETE cross-user matrix** given the identical proven pattern already covers INSERT/SELECT — worth the cost, or a low-signal box-tick?

# Fix TOCTOU Single-Use Race in Account-Deletion Token Consumption — Plan Brief

> Full plan: `context/changes/fix-account-deletion-token-toctou/plan.md`
> Research: `context/changes/fix-account-deletion-token-toctou/research.md`

## What & Why

The account-deletion consume path reads a token then burns it in two separate statements, and the burn is a non-atomic bare `UPDATE`. Two concurrent POSTs of the same raw token can both pass the gate — a single-use TOCTOU race on an irreversible endpoint. This change makes consumption atomic so exactly one caller can ever burn a given token. It closes a knowingly-deferred defect (archive impl-review F5, where the compare-and-set fix was pre-specified).

## Starting Point

`execute.ts:35` reads via `findValidDeletionToken`, then `:53` burns via `markTokenUsed` (`.update({used_at}).eq("token_hash")` — no `used_at IS NULL` guard, no affected-row check), then `:55` deletes the user. Single-use is enforced at read time, not atomically at write time, so sequential replay is blocked but concurrent replay is not.

## Desired End State

Token consumption is a single atomic compare-and-set (`UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING *`), used as the sole gate in `execute.ts` (burn → audit → delete). `findValidDeletionToken` stays a read-only helper for the confirm page. Deterministic tests prove single-use sequentially and under concurrency; the test-plan §6.6 note records the defect as fixed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Fix mechanism | Single conditional UPDATE (compare-and-set) | Race-free under READ COMMITTED via row-lock + EvalPlanQual; minimal | Research |
| DB machinery | None (no index, no RPC, no migration) | Partial unique index is inert (token_hash is PK); RPC is an unused pattern | Research |
| Function shape | New `consumeDeletionToken` as sole gate | Removes the read/burn split entirely and the duplicate-audit cost | Plan |
| Audit ordering | Accept burn → audit → delete | Trace-before-delete holds; loser aborts before any audit; rarer failure window | Plan |
| Test placement | New `account-deletion-consume.test.ts` | Clear provenance for the concurrency test | Plan |

## Scope

**In scope:** `consumeDeletionToken` service function; `execute.ts` rewire to consume-first; sequential + concurrent regression tests; test-plan §6.6 resolution note.

**Out of scope:** DB migration / partial index / RPC; `src/types.ts` regen; changing `findValidDeletionToken`; refactoring existing execute-flow tests; fresh-OTP gate / no-session posture / throttle; CI wiring.

## Architecture / Approach

Add an atomic burn-and-return to `src/lib/services/account-deletion.ts` using the repo's existing `.update(...).is("used_at", null).select()` idiom (via the service-role admin client that already bypasses RLS). Rewire the endpoint to gate on the consume result. No schema, type, or CI changes — pure service + endpoint + test.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Atomic consume | `consumeDeletionToken` + `execute.ts` consume-first | Audit-ordering tradeoff (accepted); not breaking the confirm-page read |
| 2. Tests + close-out | Sequential + concurrent regression tests; §6.6 resolved | Ensuring tests bind to `used_at` (deliberate-break verifies) |

**Prerequisites:** Local Supabase running (`npx supabase start`); existing integration suite green.
**Estimated effort:** ~1 session across 2 phases (small service change + one test file + a doc edit).

## Open Risks & Assumptions

- Accepted residual: a crash between the winning burn and the audit write leaves a spent token with no trace and no retry (rarer than today's window).
- `markTokenUsed` is retained (used by the Phase-3 isolated single-use test) but no longer on the production path — a mild footgun left in place to avoid scope creep.

## Success Criteria (Summary)

- A token can be consumed at most once — proven sequentially (second consume rejected by `used_at`, row still present) and concurrently (exactly one winner).
- The deliberate-break check fails without the `used_at IS NULL` predicate, confirming the guard.
- Full integration suite green; no schema/type/CI changes; §6.6 records the defect resolved.

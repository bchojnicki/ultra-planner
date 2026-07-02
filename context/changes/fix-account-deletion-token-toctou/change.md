---
change_id: fix-account-deletion-token-toctou
title: "Fix TOCTOU single-use race in account-deletion token consumption"
status: impl_reviewed
created: 2026-07-02
updated: 2026-07-02
archived_at: null
---

## Notes

Deferred defect surfaced by rollout Phase 3 (`testing-authorization-account-deletion-safety`)
research and recorded in `context/foundation/test-plan.md` §6.6.

**The defect.** `markTokenUsed` (`src/lib/services/account-deletion.ts:85-91`) is a
bare `UPDATE ... SET used_at = now()` with **no `used_at IS NULL` predicate and no
affected-row check**. The consume path reads (`findValidDeletionToken`) and burns
(`markTokenUsed`) in two separate statements with no DB-level atomic guard — there is
no partial unique index on unused tokens. Two concurrent `execute` requests carrying
the same raw token can both pass the read gate before either burns it, so the
single-use guarantee holds sequentially but **not** concurrently. This is the account
deletion endpoint (`src/pages/api/account/deletion/execute.ts`), which is irreversible.

**Why it was deferred, not fixed in Phase 3.** Phase 3 was a test-only rollout phase by
charter. A concurrency characterization test would be inherently flaky against local
Supabase and would document the bug as "expected," so the fix belongs in its own change.

**Fix intent (to be planned).** Make the burn a compare-and-set — e.g.
`.update({ used_at: now }).is("used_at", null)` plus an affected-row check so a losing
concurrent caller sees zero rows updated and aborts — and/or add a DB-level guard
(partial unique index on `token_hash WHERE used_at IS NULL`, or a conditional UPDATE in
a single statement). Add a regression test proving a second consume of an already-burned
token is rejected by the compare-and-set (not just by the row being gone).

**Next step:** `/10x-research` (confirm the exact concurrency surface + the cheapest
deterministic test), then `/10x-plan`.

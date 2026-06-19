<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Self-service Account Deletion

- **Plan**: context/changes/account-deletion/plan.md
- **Scope**: All 5 phases
- **Date**: 2026-06-19
- **Verdict**: NEEDS ATTENTION (robustness polish only — no blockers)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated success criteria all green: `npm run lint` clean, `npm run build` complete, 98/98 vitest tests pass, Playwright auth suite 5 passed / 10 gated-skipped. All manual checks (2.4–5.3) verified by the user.

## Findings

### F1 — Endpoints don't catch service throws (sibling pattern skipped)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency / Reliability
- **Location**: src/pages/api/account/deletion/verify.ts:~40, src/pages/api/account/deletion/execute.ts:33-51, src/pages/account/delete/confirm.astro:~20
- **Detail**: Service functions throw on Supabase error (`if (error) throw error`), but these endpoints don't try/catch — unlike sibling `aid-stations/[id].ts:31-39`. A transient DB error yields a raw Astro 500 (no friendly message, no logging) instead of the generic 502/500 already defined elsewhere. User impact contained (hook maps non-200 to generic message) but diverges from the established pattern. Subsumes F3.
- **Fix**: Wrap service calls in verify.ts and execute.ts in try/catch, return the existing generic 502/500 responses; render the "error" state in confirm.astro on a thrown lookup.
- **Decision**: FIXED (try/catch added to verify.ts + execute.ts; confirm.astro lookup wrapped → error state)

### F2 — Token burned before delete: no recovery if deleteUser fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Reliability
- **Location**: src/pages/api/account/deletion/execute.ts:49-51
- **Detail**: Ordering is audit → markTokenUsed → deleteUser. If deleteUser fails after markTokenUsed, the link is dead and the user must restart the OTP→email flow. This was a DELIBERATE plan decision (contract note: "set used_at before the delete to make the operation idempotent if the delete errors midway"). Alternative: mark used AFTER successful delete keeps the link recoverable; FK cascade removes the token on success; 30-min expiry bounds replay either way.
- **Fix A ⭐ Recommended**: Keep current order, accept as-is.
  - Strength: Matches plan's explicit reasoning; burned token can never be replayed under partial failure; deletion is rare.
  - Tradeoff: Supabase auth outage at that step strands the user mid-deletion (must restart).
  - Confidence: HIGH — plan-sanctioned, well-understood.
  - Blind spot: None significant.
- **Fix B**: Move markTokenUsed to after a successful deleteUser.
  - Strength: Retry same link if deleteUser transiently fails; cascade removes token on success.
  - Tradeoff: Reverses a documented plan decision; widens the (tiny, expiry-bounded) replay window; pairs best with atomic consume (F5).
  - Confidence: MED — safe but interacts with F5 race.
  - Blind spot: Concurrent double-submit becomes dominant if reordered.
- **Decision**: ACCEPTED — keep current order (Fix A); matches the plan's deliberate replay-safety reasoning, deletion is rare so strand-risk is minimal.

### F3 — getUserById error ignored → audit row can get empty-email hash

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (audit integrity)
- **Location**: src/pages/api/account/deletion/execute.ts:39-41
- **Detail**: `getUserById` destructured for `data` only; error ignored. On error, `email = ""` → emailHash = hash of empty string; audit row records a meaningless hash while deletion proceeds correctly by user_id.
- **Fix**: Check the error and skip/log rather than hashing "".
- **Decision**: FIXED (subsumed by F1 — execute.ts now checks `lookupError` and uses "" only on error)

### F4 — Active token blocks legitimate re-request for up to 30 min

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (UX edge)
- **Location**: src/lib/services/account-deletion.ts:36-46
- **Detail**: If the user passes OTP but loses the confirmation email, the throttle (any unused, unexpired token) returns 429 until the token expires (30 min). Acceptable for MVP.
- **Fix**: Optionally let `request` supersede an existing unused token for the same user (delete-then-issue) instead of 429.
- **Decision**: SKIPPED — accepted as MVP; 30-min self-heal is fine for a rare destructive action.

### F5 — Token consume is not atomic (theoretical double-execute race)

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/account/deletion/execute.ts:33,49
- **Detail**: Two concurrent POSTs of the same token could both pass findValidDeletionToken before either marks used → two deleteUser calls + two audit rows. Second delete is a harmless no-op; only cost is a duplicate audit row.
- **Fix**: Conditional `update … where used_at is null` and check affected rows to make consumption atomic.
- **Decision**: SKIPPED — accepted as MVP; idempotent delete, worst case a duplicate audit row.

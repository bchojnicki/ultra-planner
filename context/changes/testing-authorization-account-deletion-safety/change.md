---
change_id: testing-authorization-account-deletion-safety
title: "Test rollout Phase 3: authorization (IDOR) & account-deletion token safety"
status: implementing
created: 2026-07-02
updated: 2026-07-02
archived_at: null
---

## Notes

Rollout Phase 3 of `context/foundation/test-plan.md` — "Authorization & account-deletion safety".

**Risks covered:** Risk #4 (a logged-in runner reaches/mutates another runner's plan, aid station, or gear via a route that checks "authenticated" but not "owner" — especially service-role admin-client routes that bypass RLS / IDOR) and Risk #3 (the account-deletion confirmation token can be replayed, used after expiry, or used to delete the wrong account; the emailed link is not truly single-use, or the fresh-OTP re-auth gate is bypassable).

**Test types planned:** integration.

**Risk response intent:**
- Risk #4: prove a logged-in non-owner gets a 403/404 (not the data) on read/update/delete of another runner's plan, aid station, or gear, and that routes using the admin client still enforce ownership. Challenge "RLS covers it => every route is safe" and "authenticated => authorized"; avoid testing only the owner happy path or trusting RLS for service-role routes.
- Risk #3: prove an expired token is rejected, a used token cannot be reused, a token issued for user A cannot delete user B, the emailed link is single-use, and the fresh-OTP re-auth gate is enforced server-side. Challenge "final state deleted => the guard ran" and "a 30-min expiry being set => it is enforced on use"; avoid testing only the happy delete path or over-mocking the token store so the expiry/reuse guard never executes.

This change needs codebase grounding before a plan can be written — `/10x-research` must locate: which routes use the anon-key SSR client vs `supabaseAdmin`; where ownership is checked in app code vs RLS; the RLS policies in `supabase/migrations`; the account-deletion token table schema + hashing; where token expiry and single-use are checked; the service-role admin delete path; and the fresh-OTP re-auth gate. It should also note the existing seams (`tests/integration/rls-ownership.test.ts`, `tests/integration/account-deletion-tokens.test.ts`) and identify the net-new gaps. Next step: `/10x-research`.

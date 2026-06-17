<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Passwordless Email OTP Authentication

- **Plan**: context/changes/email-otp-auth/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-06-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation
- **Note**: reviewed inline (review sub-agents hit a session limit).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria verified: build ✓; lint ✓; vitest 61 (unit + integration) ✓; full Playwright suite 39 ✓ (earlier this session); leftover password-surface grep CLEAN; endpoint redirects all relative same-origin.

## Findings

### F1 — Plan & brief bodies describe the dropped template / "Inbucket"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/email-otp-auth/plan.md (Phase 1 #1, Migration Notes, References), plan-brief.md
- **Detail**: Two approved mid-flight deviations aren't reflected in the plan body — the custom email template was dropped (the default email already shows the code), and the mail server is Mailpit not Inbucket. The plan still lists the template as a deliverable, still says production needs a custom email template, and says "Inbucket". Code matches reality; commit messages document both deviations. Phase blocks are read-only during /10x-implement, which is why it persisted.
- **Fix**: Append a "## Addenda (post-implementation)" section to plan.md noting (a) custom template dropped → no prod template step, (b) Mailpit not Inbucket. Leaves Phase blocks intact; corrects the archived record.
- **Decision**: FIXED — added "## Addenda (post-implementation)" to plan.md reconciling both deviations (+ the F2 prod follow-up).

### F2 — request-code allows unauthenticated account creation + email to any address

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/request-code.ts:27-29
- **Detail**: signInWithOtp({ shouldCreateUser: true }) lets anyone trigger an account + an email to an arbitrary address. Supabase max_frequency throttles per-email, but there's no captcha or per-IP limit, so a script could fan out across addresses (email-bombing / mailbox enumeration). Standard for passwordless OTP signup; acceptable for MVP (low qps, after-hours).
- **Fix**: Defer for MVP. For prod, enable Supabase Auth captcha (hCaptcha/Turnstile) and/or a per-IP rate limit. No code change now.
- **Decision**: DEFERRED — to a dedicated change (needs a captcha provider + keys + Supabase captcha config and would otherwise break the OTP e2e). Prod follow-up recorded in plan.md addenda item 3.

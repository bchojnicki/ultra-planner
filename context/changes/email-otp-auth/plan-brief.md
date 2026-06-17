# Passwordless Email OTP Authentication — Plan Brief

> Full plan: `context/changes/email-otp-auth/plan.md`

## What & Why

Replace email+password auth with **passwordless email OTP** (roadmap S-06 → PRD v4 FR-001/002, US-02/03): the runner enters their email, gets a 6-digit code, and enters it to sign in. No password is stored or managed. This realigns with the project's original passwordless intent (the v3 PRD had only flipped to passwords to match the bootstrapped scaffold).

## Starting Point

Auth is a form-POST SSR scaffold: `api/auth/{signin,signup,signout}.ts` + `signin/signup/confirm-email.astro` + React forms, all password-based. Supabase is already OTP-ready (`config.toml`: `otp_length=6`, `enable_confirmations=false`); local email lands in Inbucket (:54324). The default email template renders a link, not a code.

## Desired End State

`/auth/signin` is a single page with two states — enter email → enter the emailed 6-digit code. A valid code signs in (creating the account on first use) and lands on the dashboard. Wrong/expired codes show an inline error with rate-limit-aware resend; requesting a code never reveals whether the email was registered. No password UI/endpoints/confirm-email remain; sign-out and route-gating are unchanged.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Mechanism | 6-digit email OTP code (not magic link) | Cross-device / email-client reliability | Prior turn |
| Flow shape | Single `/auth/signin`, two states (email → code) | No cross-page state-passing; one cohesive screen | Plan |
| API/session | SSR form-POST: `request-code` + `verify-code` | Matches the scaffold; cookie set server-side; CSRF-protected | Plan |
| Code delivery | Customize `magic_link` template to show `{{ .Token }}` | Users see a real code; works with Inbucket | Plan |
| Resend | Button with cooldown (respects `max_frequency`) | Recover lost/expired codes without hitting rate limit | Plan |
| Privacy | Always advance to code step; don't reveal registration | PRD AC; natural with `signInWithOtp` + `shouldCreateUser` | Plan |
| Password scaffold | Delete (signup, confirm-email, password forms/endpoints) | Passwordless is the whole point; no dead code | Plan |
| Test OTP | Read code from Inbucket API | Exercises the real flow; version-agnostic | Plan |
| Test suite | Rewrite `auth.spec.ts` + migrate 4 plan specs to an OTP helper | Password login is gone; all gated specs need it | Plan |

## Scope

**In scope:** OTP email template; `request-code`/`verify-code` endpoints; two-state passwordless `/auth/signin`; deletion of the password scaffold; shared `signInViaOtp` test helper; auth + plan spec migration; seed comment.

**Out of scope:** passwords (storage/login/reset), magic links, OAuth/MFA, middleware/RLS changes, production SMTP setup (manual dashboard step), changes to `rls-ownership.test.ts`.

## Architecture / Approach

Server-driven two-state page: `request-code` (`signInWithOtp`) redirects to `/auth/signin?step=verify&email=…`; the page passes `step`/`email`/`error` to the `SignInForm` island, which renders the code step and owns presentation + resend cooldown. The code form posts to `verify-code` (`verifyOtp` type `"email"`), which sets the session cookie via `@supabase/ssr` and redirects to `/`. Middleware and RLS are untouched.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Config + endpoints | OTP email template (`{{ .Token }}`) + `request-code`/`verify-code` (old endpoints stay) | Email template must render a code, not a link; needs a local Supabase restart |
| 2. UI + cleanup | Two-state passwordless `/auth/signin`; delete password scaffold | Dangling refs to deleted files; carrying email across the redirect |
| 3. Tests + seed | `signInViaOtp` Inbucket helper; rewrite auth spec; migrate 4 plan specs | Inbucket email-timing flakiness; broad spec churn |

**Prerequisites:** local Supabase (Docker) running for manual + e2e; ability to restart it to pick up the template. PRD v4 / roadmap S-06 already reconciled.
**Estimated effort:** ~1–2 sessions across 3 phases (UI + test migration are the bulk).

## Open Risks & Assumptions

- The `magic_link` template + `{{ .Token }}` is the correct lever for an email *code*; needs a local restart to verify (Phase 1 manual check).
- Removing password login breaks all 4 plan e2e specs' sign-in — the OTP helper migration is mandatory, not optional.
- Inbucket-backed e2e adds an email round-trip; watch for timing flakiness (poll the API).
- Production needs the hosted email template + SMTP configured by hand before real use (Migration Notes).

## Success Criteria (Summary)

- A runner signs in with only an email + an emailed 6-digit code; first-time use creates the account.
- No password UI/endpoints/confirm-email remain; sign-out and gated-route redirects still work.
- The full Playwright suite (auth + plan specs) passes via the OTP helper against local Supabase.

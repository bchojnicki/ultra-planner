# Passwordless Email OTP Authentication Implementation Plan

## Overview

Replace the email+password auth scaffold with **passwordless email OTP**: the runner enters their email, receives a 6-digit code, and enters it to sign in (roadmap S-06 → PRD v4 US-02/US-03, FR-001/FR-002). No password is stored or managed. Sign-up and sign-in are one flow (`signInWithOtp` creates the user on first use). The password scaffold is removed and the test suite migrates to an OTP sign-in helper.

## Current State Analysis

- **Auth is form-POST SSR.** `src/pages/api/auth/signin.ts` (`signInWithPassword`), `signup.ts` (`signUp` → `/auth/confirm-email`), and `signout.ts` take `formData`, call the request-scoped client (`src/lib/supabase.ts`, `@supabase/ssr`), and redirect. The session cookie is set server-side. The OTP flow fits this pattern: `signInWithOtp` (request) + `verifyOtp` (verify, sets cookie).
- **UI.** `src/pages/auth/signin.astro` renders `SignInForm.tsx` (email + password, `client:load`) and links to `/auth/signup` → `SignUpForm.tsx` (email + password + confirm). `confirm-email.astro` is the post-signup screen. Shared: `FormField.tsx`, `SubmitButton.tsx`, `ServerError.tsx`, `PasswordToggle.tsx`. Server errors surface via `?error=` query param read in the `.astro`.
- **Supabase is OTP-ready** (`supabase/config.toml`): `[auth.email]` `enable_signup = true`, `enable_confirmations = false`, `otp_length = 6`, `otp_expiry = 3600`, `max_frequency = "1s"`. Local email is captured by **Inbucket** (port 54324, has a JSON API). Email-template customization uses `[auth.email.template.<type>]` → `subject` + `content_path` (HTML file).
- **Email template caveat.** The default magic-link template renders a `ConfirmationURL` (a link), not a code. To show a 6-digit code, the `magic_link` template must render `{{ .Token }}`.
- **Middleware is auth-method-agnostic** (`src/middleware.ts` — `getUser()` from cookies, gates `/dashboard` + `/plans`). No change needed. `signout.ts` needs no change.
- **Tests depend on password login.** `tests/auth.spec.ts` tests password validation, bad-credentials, signup password rules, and the confirm-email page — all invalid once passwordless. **Critically, the 4 plan e2e specs** (`plans-setup`, `gear-units`, `plan-view`, `plan-delete`) sign in by filling Email + Password and clicking "Sign in" — removing the password form breaks their sign-in step, so they must switch to an OTP helper. `tests/integration/rls-ownership.test.ts` uses the admin API + `signInWithPassword` for its own throwaway users — independent of the app's auth UI, so it is unaffected.

## Desired End State

A logged-out runner visits `/auth/signin`, enters their email, and is taken to a code-entry step; the app emails a 6-digit code (visible as a code, via the customized template). Entering the valid code signs them in (creating the account on first use) and redirects to the dashboard. Wrong/expired codes show an inline error with a resend option (rate-limit-aware); requesting a code never reveals whether the email was already registered. No password UI, endpoints, or password-reset/confirm-email screens remain. Sign-out still works; gated routes still redirect to `/auth/signin`.

Verify: the full request→email→code→session flow works in `wrangler dev`/`astro dev` against local Supabase; the Playwright suite (auth + the 4 plan specs) is green via the OTP helper; no references to deleted password files remain; build + lint pass.

### Key Discoveries:

- `signInWithOtp({ email, options: { shouldCreateUser: true } })` unifies sign-up + sign-in and naturally satisfies the "don't reveal if registered" privacy AC.
- `verifyOtp({ email, token, type: "email" })` validates the 6-digit code and sets the session cookie via the SSR client — must run server-side (matches the form-POST pattern).
- Email template config pattern: `supabase/config.toml` `[auth.email.template.magic_link]` with `content_path = "./supabase/templates/magic_link.html"` containing `{{ .Token }}` (`config.toml:229-232` shows the shape for `invite`).
- Inbucket JSON API at `http://127.0.0.1:54324` lets the e2e read the sent email and extract the code (version-agnostic; exercises the real flow).
- The `?error=` query-param convention (`signin.astro:5`) is the established way to surface server-side auth errors back to the page; the OTP flow reuses it plus a `step`/`email` param to drive the two-state page across redirects.

## What We're NOT Doing

- **No password anything** — no password storage, login, reset, or change. No magic *link* (we send a code).
- **No separate sign-up flow / no email-confirmation screen** — `signInWithOtp` unifies them; `confirm-email.astro` is removed.
- **No social / OAuth providers, no MFA, no "remember this device"** — out of MVP scope.
- **No middleware or RLS changes** — auth method is orthogonal to ownership scoping.
- **No production SMTP setup in this change** — local uses Inbucket; the prod email template + SMTP are a documented manual step (Migration Notes).
- **No change to `rls-ownership.test.ts`** — it manages its own users via the admin API.

## Implementation Approach

Add the OTP endpoints + email template first (non-destructive, so the app keeps working), then swap the UI to the two-state passwordless flow and delete the password scaffold, then migrate the tests to an Inbucket-backed OTP helper. The two-state page is server-driven: `request-code` redirects back to `/auth/signin?step=verify&email=<email>`; the page passes `step`/`email`/`error` to the island, which renders the code step and owns presentation + the resend cooldown. The code form POSTs to `verify-code`, which sets the cookie and redirects to `/`.

## Critical Implementation Details

- **Email carried across the redirect via query param.** `request-code` redirects to `/auth/signin?step=verify&email=<encoded>`; `verify-code` re-renders the same step with `&error=` on failure. Email isn't secret, and this mirrors the existing `?error=` convention — no server-side session needed.
- **Rate limit vs resend.** Supabase `max_frequency = "1s"` (local) limits send frequency; the resend control's cooldown must respect it, and `request-code` must map a rate-limit error to a friendly message rather than a raw 500.
- **`verifyOtp` type is `"email"`** for `signInWithOtp` email codes (not `"magic_link"` / `"signup"`). Using the wrong `type` fails verification.

## Phase 1: Supabase OTP config + email template + request/verify endpoints

### Overview

Stand up the passwordless backend without breaking the existing app (old password endpoints remain until Phase 2).

### Changes Required:

#### 1. OTP email template (show a 6-digit code)

**File**: `supabase/config.toml` + `supabase/templates/magic_link.html` (new)

**Intent**: Make the OTP email render the 6-digit code instead of the default link, so users (and Inbucket-based tests) get a readable code.

**Contract**: Add `[auth.email.template.magic_link]` with `subject` and `content_path = "./supabase/templates/magic_link.html"`. The HTML template includes `{{ .Token }}` (the 6-digit code) with minimal branding. Requires a local Supabase restart (`npx supabase stop && start`, or `db reset`) to take effect.

#### 2. Request-code endpoint

**File**: `src/pages/api/auth/request-code.ts` (new)

**Intent**: Email a one-time code for the submitted address, creating the account on first use, without revealing whether the email was already registered.

**Contract**: `POST`, reads `email` from `formData`; calls `signInWithOtp({ email, options: { shouldCreateUser: true } })`. On success → redirect `/auth/signin?step=verify&email=<encoded>`. On a rate-limit error → redirect back with a friendly `&error=`. Other errors → generic `&error=`. Always advances to the verify step for a valid-format email (privacy). Mirrors the `signin.ts` redirect/error shape.

#### 3. Verify-code endpoint

**File**: `src/pages/api/auth/verify-code.ts` (new)

**Intent**: Verify the entered code, establish the session, and land the runner on the dashboard.

**Contract**: `POST`, reads `email` + `token` from `formData`; calls `verifyOtp({ email, token, type: "email" })`. On success → redirect `/` (cookie set by the SSR client). On failure (invalid/expired) → redirect `/auth/signin?step=verify&email=<encoded>&error=<msg>`. Mirrors the request-scoped-client + redirect pattern.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- After a local Supabase restart, `POST /api/auth/request-code` (form) sends an email visible in Inbucket (`http://127.0.0.1:54324`) containing a 6-digit code
- `POST /api/auth/verify-code` with that code returns a redirect to `/` and sets a session cookie; a wrong code redirects back with an error
- A second immediate request surfaces a friendly rate-limit message, not a 500

**Implementation Note**: After automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Passwordless UI + remove password scaffold

### Overview

Swap the UI to the two-state email→code flow and delete all password-related files.

### Changes Required:

#### 1. Rewrite the sign-in form

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Replace the email+password form with a two-state flow: (a) email step → posts to `request-code`; (b) code step → posts to `verify-code`, with a resend control (cooldown), a "use a different email" link back to the email step, and inline error display.

**Contract**: Props `{ step: "email" | "verify"; email?: string; serverError?: string | null }` (driven by the page from query params). Email step: one email `FormField` (client-validates format), submit posts to `/api/auth/request-code`. Code step: a 6-digit code field + hidden `email`, submit posts to `/api/auth/verify-code`; a "Resend code" button disabled for a short cooldown aligned with `max_frequency`; a back link to `?step=email`. Reuses `FormField`/`SubmitButton`/`ServerError`. No password, no `PasswordToggle`.

#### 2. Rewrite the sign-in page

**File**: `src/pages/auth/signin.astro`

**Intent**: Drive the two-state island from query params and remove sign-up affordances.

**Contract**: Read `step` (default `"email"`), `email`, and `error` from `Astro.url.searchParams`; pass to `SignInForm`. Update copy ("Enter your email and we'll send you a sign-in code"). Remove the "Don't have an account? Sign up" link (sign-up is unified into this flow).

#### 3. Delete the password scaffold

**File**: remove `src/pages/auth/signup.astro`, `src/components/auth/SignUpForm.tsx`, `src/pages/api/auth/signup.ts`, `src/pages/api/auth/signin.ts`, `src/pages/auth/confirm-email.astro`, `src/components/auth/PasswordToggle.tsx`

**Intent**: Eliminate the dead password surface now that the OTP flow replaces it.

**Contract**: Files deleted. Verify nothing imports them (`PasswordToggle`, `SignUpForm`) and no links point to `/auth/signup` or `/auth/confirm-email` (the signin page link is removed in change #2). `signout.ts`, `FormField.tsx`, `SubmitButton.tsx`, `ServerError.tsx` stay.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint` (catches dangling imports/unused files)
- No references to deleted paths: `grep -rE "auth/signup|confirm-email|PasswordToggle|signInWithPassword|SignUpForm" src/` returns nothing

#### Manual Verification:

- `/auth/signin` shows an email-only form; submitting a valid email advances to the code step
- Entering the Inbucket code signs in and lands on the dashboard; a new email creates an account on first code entry
- Wrong/expired code shows an inline error; "Resend" works after the cooldown; "use a different email" returns to the email step
- `/auth/signup` and `/auth/confirm-email` 404; sign-out still works; an unauthenticated hit on `/dashboard` redirects to `/auth/signin`

**Implementation Note**: After automated checks pass, pause for manual confirmation before Phase 3.

---

## Phase 3: Tests + seed reconciliation

### Overview

Migrate the test suite from password login to an OTP sign-in helper and align the seed.

### Changes Required:

#### 1. Shared OTP sign-in helper

**File**: `tests/helpers/otp.ts` (new)

**Intent**: One reusable way for gated e2e specs to authenticate via the real OTP flow.

**Contract**: Export `signInViaOtp(page, email)` — navigates to `/auth/signin`, submits the email, reads the latest message for that address from the Inbucket API (`http://127.0.0.1:54324`), extracts the 6-digit code, enters it, and waits for the post-login redirect. Also export a small Inbucket fetch/extract util. Gated by `TEST_EMAIL`/local Supabase like the other specs.

#### 2. Rewrite the auth spec

**File**: `tests/auth.spec.ts`

**Intent**: Reflect the passwordless flow.

**Contract**: Remove the password-validation, bad-credentials, signup-page (password rules / confirm-password), and confirm-email cases. Keep "protected route → redirect to sign-in". Add: email-step renders (email field, no password), email format validation, advancing to the code step, an invalid-code inline error, and a full success path via `signInViaOtp`.

#### 3. Migrate the plan specs to the OTP helper

**File**: `tests/plans-setup.spec.ts`, `tests/gear-units.spec.ts`, `tests/plan-view.spec.ts`, `tests/plan-delete.spec.ts`

**Intent**: Replace each spec's password sign-in step with `signInViaOtp`.

**Contract**: Swap the "fill Email + Password → click Sign in" block for `await signInViaOtp(page, email)`. No other test logic changes. `TEST_PASSWORD` is no longer required by these specs (keep `TEST_EMAIL` or a per-test address).

#### 4. Reconcile the seed comment

**File**: `supabase/seed.sql`

**Intent**: Stop advertising a password-based test login.

**Contract**: Update the header comment to describe the seeded row as a pre-confirmed user whose password is vestigial under OTP (sign in by entering the email and reading the code from Inbucket). No structural change required (the confirmed `auth.users` row is still useful).

### Success Criteria:

#### Automated Verification:

- New/updated specs pass against local Supabase: `npx playwright test tests/auth.spec.ts` (with `TEST_EMAIL` set)
- Full e2e suite green: `npx playwright test`
- Integration suite still green: `npx vitest run tests/integration`
- Linting passes: `npm run lint`

#### Manual Verification:

- Gated specs are skipped (not failed) when `TEST_EMAIL` is unset, matching the existing convention
- The Inbucket-backed success path is reliable across a couple of runs (no flakiness from email timing)

**Implementation Note**: After automated checks pass, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- None — auth is a thin flow over Supabase + SSR cookies; behavior is covered end-to-end.

### Integration Tests:

- `tests/integration/rls-ownership.test.ts` is unaffected (own users via admin API) and must stay green.

### Manual Testing Steps:

1. Local Supabase restart; `/auth/signin` → enter a new email → code step.
2. Open Inbucket (`:54324`), read the 6-digit code, enter it → dashboard (account created on first use).
3. Sign out → sign in again with the same email + a fresh code.
4. Enter a wrong code → inline error; resend after cooldown.
5. Hit `/dashboard` unauthenticated → redirect to `/auth/signin`; confirm `/auth/signup` + `/auth/confirm-email` 404.

## Performance Considerations

Negligible; OTP adds one email round-trip per login. The e2e's Inbucket read adds ~1s per signed-in spec — acceptable for the gated suite.

## Migration Notes

- **Production email**: the hosted Supabase project must have the Magic Link email template updated to render `{{ .Token }}` (the 6-digit code), and SMTP configured, before prod use — a manual dashboard step (out of this change's automated scope).
- **Existing password users**: any accounts created under the old flow keep working — OTP signs in any existing confirmed user by email; their stored password simply goes unused.
- No data migration or schema change.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-06)
- PRD: `context/foundation/prd.md` v4 (US-02, US-03, FR-001, FR-002, Access Control)
- Change identity + decision: `context/changes/email-otp-auth/change.md`
- Auth scaffold being replaced: `src/pages/api/auth/*.ts`, `src/pages/auth/*.astro`, `src/components/auth/*`
- SSR client: `src/lib/supabase.ts`; middleware: `src/middleware.ts`
- Supabase config: `supabase/config.toml` (`[auth.email]`, `[inbucket]`)
- Infra risk (auth + Workers cookies): `context/foundation/infrastructure.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Supabase OTP config + email template + request/verify endpoints

#### Automated

- [x] 1.1 Type checking / build passes: `npx astro sync && npm run build` — 8d33e14
- [x] 1.2 Linting passes: `npm run lint` — 8d33e14

#### Manual

- [x] 1.3 `request-code` sends an Inbucket email containing a 6-digit code (after local restart) — 8d33e14
- [x] 1.4 `verify-code` with the code redirects to `/` and sets a session cookie; wrong code redirects back with an error — 8d33e14
- [x] 1.5 A rapid second request surfaces a friendly rate-limit message, not a 500 — 8d33e14

### Phase 2: Passwordless UI + remove password scaffold

#### Automated

- [x] 2.1 Type checking / build passes: `npx astro sync && npm run build` — 1d1f40f
- [x] 2.2 Linting passes: `npm run lint` — 1d1f40f
- [x] 2.3 No references to deleted paths: `grep -rE "auth/signup|confirm-email|PasswordToggle|signInWithPassword|SignUpForm" src/` returns nothing — 1d1f40f

#### Manual

- [x] 2.4 `/auth/signin` shows an email-only form; valid email advances to the code step — 1d1f40f
- [x] 2.5 Inbucket code signs in and lands on the dashboard; new email creates an account on first use — 1d1f40f
- [x] 2.6 Wrong/expired code shows inline error; resend works after cooldown; "different email" returns to email step — 1d1f40f
- [x] 2.7 `/auth/signup` + `/auth/confirm-email` 404; sign-out works; unauth `/dashboard` redirects to `/auth/signin` — 1d1f40f

### Phase 3: Tests + seed reconciliation

#### Automated

- [x] 3.1 Auth spec passes: `npx playwright test tests/auth.spec.ts`
- [x] 3.2 Full e2e suite green: `npx playwright test`
- [x] 3.3 Integration suite still green: `npx vitest run tests/integration`
- [x] 3.4 Linting passes: `npm run lint`

#### Manual

- [x] 3.5 Gated specs skip (not fail) when `TEST_EMAIL` is unset
- [x] 3.6 Inbucket-backed success path is reliable across a couple of runs

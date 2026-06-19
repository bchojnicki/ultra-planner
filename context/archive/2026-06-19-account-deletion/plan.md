# Self-service Account Deletion Implementation Plan

## Overview

Implement an email-confirmed, irreversible account-deletion flow. A logged-in user opens a Settings menu, chooses the destructive **Remove account**, re-authenticates via a fresh OTP code, and receives a single-use confirmation link (sent through Resend). Clicking the link lands on a confirm page; an explicit POST then performs a **hard** delete of the `auth.users` row via a service-role admin client. The existing `ON DELETE CASCADE` chain wipes all connected plans, aid stations, gear, and selections. A cascade-surviving audit row records that the deletion happened.

## Current State Analysis

- **Cascade is already wired** — deleting the `auth.users` row removes every connected row: `plans.user_id → auth.users(id) on delete cascade` (`supabase/migrations/20260603132423_create_plans_and_aid_stations.sql:24`), `aid_stations.plan_id`/`gear_items.plan_id`/`gear_segment_selections.plan_id`+`gear_item_id` all cascade off `plans(id)` (`20260603132423:52`, `20260616073640:24`, `20260616073641:23-24`, `20260616073642:17`). No app-level cascade code is needed.
- **No service-role key wired** — the SSR client uses the anon `SUPABASE_KEY` (`src/lib/supabase.ts:1-24`); env schema declares only `SUPABASE_URL`/`SUPABASE_KEY` (`astro.config.mjs:16-22`). The admin pattern (`createClient(url, serviceRoleKey, { auth: { persistSession:false, autoRefreshToken:false } })` → `admin.auth.admin.deleteUser(id)`) already exists in `tests/integration/rls-ownership.test.ts:81-83,139`.
- **No transactional mailer** — the only email path is Supabase Auth OTP (`src/pages/api/auth/request-code.ts:25` `signInWithOtp`, `verify-code.ts:25` `verifyOtp`). Supabase auth emails can only carry fixed auth-template links, so a custom delete link requires an external mailer (Resend, chosen). Supabase OTP email is rate-limited to `email_sent = 2`/hr (`supabase/config.toml:182`).
- **API conventions** — uppercase method exports, `export const prerender = false`, `locals.user` auth check, a `json()` helper, error-code mapping `42501→403`/`PGRST116→404`/else 500 (`src/pages/api/aid-stations/[id].ts:35-43`).
- **Nav** — `src/components/public/PublicNav.astro:19-41` is auth-aware; logged-in state currently shows a `<form method="POST" action="/api/auth/signout">` Sign out (lines 24-31). React islands use `client:load` (e.g. `dashboard.astro:25`). `dropdown-menu` is NOT installed in `src/components/ui/`; Radix (`radix-ui ^1.6.0`) and a `destructive` button variant already exist.
- **Middleware** — `src/middleware.ts:4-24` resolves `locals.user` and redirects `PROTECTED_ROUTES` (`/dashboard`, `/plans`) when unauthenticated.

## Desired End State

A logged-in user can permanently delete their account and all connected data through a guarded flow, verifiable by: (1) the Settings dropdown appears for logged-in users with Logout + a red Remove account; (2) initiating deletion sends an OTP, then (after OTP verify) a Resend email with a single-use link; (3) the link opens a confirm page that only deletes on an explicit POST; (4) after confirmation the `auth.users` row and all plans/aid_stations/gear/selections are gone, the session is cleared, and an audit row persists; (5) the link is single-use and expires after 30 minutes.

### Key Discoveries:

- Hard delete is required — `deleteUser(id)` defaults `shouldSoftDelete=false`; a soft delete leaves the `auth.users` row and the cascade never fires (research §1).
- Deleting a user does NOT invalidate existing access tokens (Supabase) — clear the local session at execute and keep relying on short JWT expiry.
- The confirm page must be reachable **without** a session (clicked from email on any device) — do NOT add it to `PROTECTED_ROUTES`; the token is the credential.
- All `account_deletion_tokens`/`account_deletion_events` access goes through the service-role admin client; enable RLS with no policies (deny authenticated/anon; service_role bypasses RLS).
- supabase-js v2 admin REST calls are plain `fetch` and run on Workers; bind global fetch and disable session persistence.

## What We're NOT Doing

- No data export / download-before-delete, no GDPR data-portability bundle.
- No soft-delete grace period or self-service undo/recovery window (deletion is immediate and irreversible once confirmed).
- No admin-initiated or bulk deletion; no deletion from external systems (none exist).
- No collapsing of the two-email flow in this change (OTP re-auth + Resend link are both kept by decision).
- No new IP-level rate-limiting infrastructure (KV/Durable Objects) — DB-based per-user throttle only.

## Implementation Approach

Build bottom-up: foundation (secrets, admin client, mailer, schema) first so later phases have working primitives, then the two backend halves of the flow (issue token → consume token), then the UI that drives them, then docs. Each backend phase is independently testable against a local Supabase. All token-table and audit access is server-only via the service-role admin client; the user-facing app keeps using the anon SSR client.

## Critical Implementation Details

- **Two distinct Supabase clients.** The cookie-bound `@supabase/ssr` client (anon, RLS-enforced) stays for normal calls; a new server-only `@supabase/supabase-js` admin client (service-role, no session) is used exclusively for token-table access and `deleteUser`. The admin module must never be imported by a client island.
- **Token at rest is a hash.** Generate a high-entropy random token, email the raw value in the link, store only its SHA-256 in `account_deletion_tokens`. Validation hashes the inbound param and looks up an unexpired, unused row.
- **Audit row must survive the cascade.** `account_deletion_events.user_id` is a plain `uuid` column with **no FK** to `auth.users` — a FK with cascade would erase the audit row along with the user.
- **Supabase OTP email cap.** The re-auth OTP uses Supabase's built-in email, capped at 2/hr (`config.toml:182`); acceptable for deletion frequency but note it in error messaging.

## Phase 1: Backend Foundation (secrets, admin client, mailer, schema)

### Overview

Add the service-role and Resend secrets, a server-only admin client, a Resend email service, and the two new tables. No user-facing behavior yet.

### Changes Required:

#### 1. Environment schema

**File**: `astro.config.mjs`

**Intent**: Declare the new server-only secrets so the admin client and mailer can read them via `astro:env/server`.

**Contract**: Add to `env.schema`: `SUPABASE_SERVICE_ROLE_KEY` (`context: "server", access: "secret", optional: true`), `RESEND_API_KEY` (same), and `RESEND_FROM_EMAIL` (`context: "server", access: "secret", optional: true` — not strictly secret but kept server-side and optional to match the existing graceful-degradation pattern).

#### 2. Service-role admin client

**File**: `src/lib/supabaseAdmin.ts` (new)

**Intent**: Provide a factory that returns a Workers-compatible service-role client for token-table access and user deletion. Server-only; never imported by an island.

**Contract**: Exports `createAdminClient(): SupabaseClient<Database> | null` (returns `null` if secrets unset, mirroring `src/lib/supabase.ts`). Uses `@supabase/supabase-js` `createClient` with `auth: { autoRefreshToken: false, persistSession: false }` and `global: { fetch: fetch.bind(globalThis) }`.

#### 3. Resend email service

**File**: `src/lib/services/email.ts` (new)

**Intent**: Wrap sending the deletion-confirmation email via Resend's HTTP API (no SMTP, Workers-friendly), keeping all email concerns in one place.

**Contract**: Exports `sendDeletionConfirmationEmail({ to, confirmUrl })`. POSTs to `https://api.resend.com/emails` with `Authorization: Bearer ${RESEND_API_KEY}`, `from: RESEND_FROM_EMAIL`, a subject and an HTML body containing `confirmUrl`. Returns a discriminated result (`ok`/error) so callers can map failures to 5xx.

#### 4. Migration: deletion tokens

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_create_account_deletion_tokens.sql` (new)

**Intent**: Single-use, expiring, user-scoped confirmation tokens; only the service-role path touches the table.

**Contract**: Table `account_deletion_tokens(token_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade, requested_ip inet, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now())`; index on `user_id`. `enable row level security` with **no** policies for `authenticated`/`anon` (service*role bypasses RLS). Header comment follows the `20260603132423*\*` convention.

#### 5. Migration: deletion audit events

**File**: `supabase/migrations/<YYYYMMDDHHmmss+1>_create_account_deletion_events.sql` (new)

**Intent**: A record that a deletion occurred, deliberately decoupled from `auth.users` so it survives the cascade.

**Contract**: Table `account_deletion_events(id uuid primary key default gen_random_uuid(), user_id uuid not null, email_hash text not null, requested_ip inet, deleted_at timestamptz not null default now())`. **No FK** on `user_id`. `enable row level security` with no `authenticated`/`anon` policies.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `npx supabase db reset` (or `npx supabase migration up`)
- `npx astro sync` regenerates env types without error
- Type checking passes: `npm run lint`
- Build passes: `npm run build`
- Integration test: admin client deletes a seeded user and the cascade removes their plans/aid_stations/gear (extend the pattern in `tests/integration/rls-ownership.test.ts`)

#### Manual Verification:

- With local secrets set in `.dev.vars`, a scratch call to `sendDeletionConfirmationEmail` lands in Mailpit/Resend test inbox
- `createAdminClient()` returns a working client when secrets are present and `null` when absent

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Deletion Request + Re-auth + Token Issuance

### Overview

Add the two endpoints that gate deletion behind a fresh OTP re-auth and then issue + email a single-use token.

### Changes Required:

#### 1. Deletion request endpoint

**File**: `src/pages/api/account/deletion/request.ts` (new)

**Intent**: Authenticated user asks to delete; we send a fresh OTP re-auth code, throttled per-user.

**Contract**: `POST`, `prerender = false`. Requires `locals.user` (401 otherwise). DB rate-limit via admin client: reject (429) if an unused, unexpired token already exists for the user within the last 30 min. Calls `supabase.auth.signInWithOtp({ email: user.email, shouldCreateUser: false })`. Returns 204/JSON ok. zod-validates any body.

#### 2. Deletion verify endpoint (issue + email token)

**File**: `src/pages/api/account/deletion/verify.ts` (new)

**Intent**: Verify the OTP, then mint a single-use deletion token, store its hash, and email the confirmation link.

**Contract**: `POST`, `prerender = false`, requires `locals.user`. Body `{ code: string }` (zod). Calls `supabase.auth.verifyOtp({ email: user.email, token: code, type: "email" })`; on failure 400. On success: generate random token, insert `{ token_hash, user_id, expires_at = now()+30min, requested_ip }` via admin client, build `confirmUrl = new URL("/account/delete/confirm?token=<raw>", origin)`, send via `sendDeletionConfirmationEmail`. Map email-send failure to 502/500. Returns ok ("check your email").

### Success Criteria:

#### Automated Verification:

- Type/lint passes: `npm run lint`
- Build passes: `npm run build`
- Integration test: unauthenticated request → 401; second request within window → 429; verify with bad code → 400; verify with good code inserts exactly one token row with a hash (not the raw token) and a ~30-min expiry

#### Manual Verification:

- Initiating deletion delivers an OTP email; entering the code triggers a Resend email containing a `/account/delete/confirm?token=...` link
- The stored row contains a hash, not the raw token

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Confirm Page + Execute (consume token, hard delete, audit)

### Overview

Add the public confirm page and the execute endpoint that consumes the token, performs the hard delete, writes the audit row, and clears the session.

### Changes Required:

#### 1. Confirm page

**File**: `src/pages/account/delete/confirm.astro` (new)

**Intent**: Landing page for the emailed link; shows what will be deleted and a single explicit Confirm button. Read-only — never deletes.

**Contract**: SSR page, reachable without a session (must NOT be added to `PROTECTED_ROUTES`). Reads `token` from query; uses the admin client to check the token exists/unexpired/unused and renders one of: valid (confirm form), expired/invalid, already-used. The confirm form POSTs the token to the execute endpoint.

#### 2. Execute endpoint

**File**: `src/pages/api/account/deletion/execute.ts` (new)

**Intent**: Consume a valid token and irreversibly delete the account, recording the event.

**Contract**: `POST`, `prerender = false`. Token is the credential — does **not** require `locals.user`. Body/form `{ token }` (zod). Hash → look up unused, unexpired row (else 400/410). Then, in order: write `account_deletion_events` (user_id, `email_hash`, requested_ip); call `admin.auth.admin.deleteUser(user_id)` (hard delete → cascade); mark `used_at` (or rely on the token row's own cascade removal — see note); clear the visitor's Supabase cookies via `context.cookies`. Redirect to a goodbye page.

**Contract note**: deleting the user cascades `account_deletion_tokens` (FK to `auth.users`) away, so the row self-cleans; still set `used_at` before the delete call to make the operation idempotent if the delete errors midway. Write the audit row **before** the delete so a mid-operation failure still leaves a trace.

#### 3. Goodbye page

**File**: `src/pages/account/delete/done.astro` (new)

**Intent**: Confirmation that the account was deleted; link home.

**Contract**: Static SSR page, public.

### Success Criteria:

#### Automated Verification:

- Type/lint passes: `npm run lint`
- Build passes: `npm run build`
- Integration test (end-to-end): seed user + plan/gear → issue token → POST execute → assert `auth.users` row gone, all plans/aid_stations/gear/selections gone (cascade), one `account_deletion_events` row present, token unusable on replay (400/410)

#### Manual Verification:

- Clicking the email link shows the confirm page; clicking Confirm deletes the account and lands on the goodbye page
- Visiting an expired/used/garbage token shows the correct non-destructive message
- After deletion, the previously-logged-in browser is signed out

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Settings UI (shadcn dropdown island)

### Overview

Replace the inline Sign-out form with a Settings dropdown offering Logout and a destructive Remove account that drives the Phase 2 flow.

### Changes Required:

#### 1. Install dropdown-menu

**File**: `src/components/ui/dropdown-menu.tsx` (new, via `npx shadcn@latest add dropdown-menu`)

**Intent**: Bring in the accessible shadcn dropdown primitive (Radix-backed) in the "new-york" style.

**Contract**: Standard shadcn dropdown-menu component; no custom changes.

#### 2. SettingsMenu island

**File**: `src/components/public/SettingsMenu.tsx` (new)

**Intent**: Client island rendering a Settings trigger → dropdown with Logout and a red Remove account; Remove account opens a confirm modal that runs request → OTP entry → verify.

**Contract**: React component, hydrated `client:load`. Logout POSTs to `/api/auth/signout` (preserve existing behavior). Remove account uses the `destructive` button variant and a modal that: calls `/api/account/deletion/request`, prompts for the OTP code, then calls `/api/account/deletion/verify`, then shows "check your email." Surfaces 429/400/5xx as inline errors. Extract any non-trivial logic to `src/components/hooks/` per convention.

#### 3. Wire into nav

**File**: `src/components/public/PublicNav.astro`

**Intent**: Render `SettingsMenu` for logged-in users in place of the current Sign-out form.

**Contract**: Replace the logged-in `<form … signout>` block (lines ~24-31) with `<SettingsMenu client:load />`; keep logged-out markup unchanged.

### Success Criteria:

#### Automated Verification:

- Type/lint passes: `npm run lint`
- Build passes: `npm run build`
- Existing Playwright auth suite still passes: `npx playwright test`

#### Manual Verification:

- Logged-in users see Settings with Logout + red Remove account; logged-out users see Sign in unchanged
- Logout still works
- Remove account runs the OTP → email flow with visible error states for throttling/bad code

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Docs & PRD

### Overview

Record the new privacy capability and the new secrets.

### Changes Required:

#### 1. PRD functional requirement

**File**: `context/foundation/prd.md`

**Intent**: Add a right-to-erasure / account-deletion functional requirement so the PRD reflects the first account-lifecycle/privacy capability.

**Contract**: New FR describing self-service, email-confirmed, irreversible deletion with full data cascade; placed in the functional-requirements section consistent with existing FR formatting.

#### 2. Env + setup docs

**File**: `README.md` (and `.dev.vars`/CLAUDE.md env notes as applicable)

**Intent**: Document the three new secrets and the Resend domain-verification prerequisite.

**Contract**: Add `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` to the env/secrets sections (local `.dev.vars`, `wrangler secret put`, GitHub CI secrets), noting Resend domain verification must be done before sending works.

### Success Criteria:

#### Automated Verification:

- Markdown/prettier formatting passes: `npm run format`

#### Manual Verification:

- Full happy-path walkthrough on a fresh local env confirms each documented secret is sufficient to run the flow
- PRD reads coherently with the new FR

**Implementation Note**: Final phase — confirm the full end-to-end flow manually.

---

## Testing Strategy

### Unit Tests:

- Token hashing (raw → SHA-256) and validation (expired / used / unknown → rejected)
- Email service result mapping (Resend non-200 → error result)

### Integration Tests:

- Admin cascade: deleting a seeded user removes all their plans/aid_stations/gear/selections
- Request throttle: second request inside the window → 429
- OTP verify gate: bad code → 400; good code → exactly one hashed token row
- End-to-end execute: token → hard delete → cascade + audit row + replay rejection

### Manual Testing Steps:

1. Log in, open Settings, click Remove account, complete OTP, receive the Resend link
2. Click the link → confirm page → Confirm → goodbye page; verify data and session are gone
3. Re-use the same link → "already used"; visit an expired token → "expired"
4. Trigger the request twice quickly → throttled message
5. Confirm logged-out users see unchanged nav

## Performance Considerations

Negligible load (deletion is rare). The only added per-request work is one indexed token lookup on the admin client during confirm/execute and one throttle query on request.

## Migration Notes

Two additive migrations create new tables only; no changes to existing tables or data. Safe to apply forward; rollback is dropping the two new tables.

## References

- Research: `context/changes/account-deletion/research.md`
- Change identity: `context/changes/account-deletion/change.md`
- Admin-delete pattern: `tests/integration/rls-ownership.test.ts:81-83,139`
- Cascade root: `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql:24`
- API convention: `src/pages/api/aid-stations/[id].ts:35-43`
- Nav to modify: `src/components/public/PublicNav.astro:24-31`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend Foundation

#### Automated

- [x] 1.1 Migrations apply cleanly (`npx supabase db reset`) — 436588a
- [x] 1.2 `npx astro sync` regenerates env types without error — 436588a
- [x] 1.3 Type/lint passes (`npm run lint`) — 436588a
- [x] 1.4 Build passes (`npm run build`) — 436588a
- [x] 1.5 Integration test: admin delete cascades a seeded user's data — 436588a

#### Manual

- [x] 1.6 `sendDeletionConfirmationEmail` lands in the test inbox with local secrets set — 436588a
- [x] 1.7 `createAdminClient()` returns a client with secrets, `null` without — 436588a

### Phase 2: Deletion Request + Re-auth + Token Issuance

#### Automated

- [x] 2.1 Type/lint passes (`npm run lint`) — ae69d15
- [x] 2.2 Build passes (`npm run build`) — ae69d15
- [x] 2.3 Integration test: 401 unauth, 429 throttle, 400 bad code, good code inserts one hashed ~30-min token — ae69d15

#### Manual

- [x] 2.4 OTP email then Resend confirmation-link email delivered — 34d86a7
- [x] 2.5 Stored token row contains a hash, not the raw token — 34d86a7

### Phase 3: Confirm Page + Execute

#### Automated

- [x] 3.1 Type/lint passes (`npm run lint`) — c0c3197
- [x] 3.2 Build passes (`npm run build`) — c0c3197
- [x] 3.3 End-to-end test: token → hard delete → cascade gone + audit row present + replay rejected — c0c3197

#### Manual

- [x] 3.4 Link → confirm page → Confirm → goodbye; data and session gone — 34d86a7
- [x] 3.5 Expired/used/garbage token shows correct non-destructive message — 34d86a7
- [x] 3.6 Previously-logged-in browser is signed out after deletion — 34d86a7

### Phase 4: Settings UI

#### Automated

- [x] 4.1 Type/lint passes (`npm run lint`) — fcebf79
- [x] 4.2 Build passes (`npm run build`) — fcebf79
- [x] 4.3 Existing Playwright auth suite passes (`npx playwright test`) — fcebf79

#### Manual

- [x] 4.4 Logged-in users see Settings (Logout + red Remove account); logged-out nav unchanged — 34d86a7
- [x] 4.5 Logout still works — 34d86a7
- [x] 4.6 Remove account runs OTP → email flow with error states for throttle/bad code — 34d86a7

### Phase 5: Docs & PRD

#### Automated

- [x] 5.1 Formatting passes (`npm run format`) — 34d86a7

#### Manual

- [x] 5.2 Fresh-env walkthrough confirms documented secrets suffice — 34d86a7
- [x] 5.3 PRD reads coherently with the new right-to-erasure FR — 34d86a7

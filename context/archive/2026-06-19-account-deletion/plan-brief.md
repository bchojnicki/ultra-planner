# Self-service Account Deletion — Plan Brief

> Full plan: `context/changes/account-deletion/plan.md`
> Research: `context/changes/account-deletion/research.md`

## What & Why

Let a logged-in user permanently delete their account and all connected data (plans, aid stations, gear, selections). Because the action is destructive and irreversible, it is guarded by re-authentication plus an emailed single-use confirmation link before anything is deleted.

## Starting Point

The schema already cascades from `auth.users` (deleting the user removes all their data automatically), but the app has no service-role key wired (only the anon SSR client), no transactional mailer, and the nav shows a plain Sign-out form. The admin-delete pattern already exists in the integration tests and can be lifted.

## Desired End State

A Settings dropdown (Logout + a red Remove account) drives a flow: OTP re-auth → emailed Resend link → confirm page → explicit POST → a service-role **hard** delete that cascades all user data. The session is cleared, a cascade-surviving audit row is written, and the user lands on a goodbye page. Links are single-use and expire in 30 minutes.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Email mechanism | Custom token table + Resend | Supabase auth emails can't carry a custom delete link | Research |
| Data cascade | Rely on existing `ON DELETE CASCADE` | Already wired from `auth.users` down | Research |
| Delete type | Hard delete (`shouldSoftDelete=false`) | Soft delete leaves the row and skips the cascade | Research |
| Proof of intent | Fresh OTP re-auth | Reuses the app's only auth primitive; proves live inbox control | Plan |
| Link behavior | Confirm page + explicit POST | Avoids CSRF/prefetch auto-deletion on a bare GET | Plan |
| Token TTL | 30 minutes, single-use, hashed at rest | Tight blast radius if a link leaks | Plan |
| Rate limiting | DB-based per-user (token table) | No new infra; reuses the table being built | Plan |
| Settings UI | shadcn dropdown-menu island | Accessible, matches conventions; Radix already a dep | Plan |
| Audit | Minimal row, no FK to `auth.users` | Survives the cascade for erasure evidence/forensics | Plan |
| Mailer setup | Verified-domain Resend sender | Deliverability + production-ready (needs DNS verification) | Plan |
| PRD | Add right-to-erasure FR now | First account-lifecycle/privacy capability | Plan |

## Scope

**In scope:** Settings dropdown, OTP re-auth, Resend confirmation link, confirm/execute endpoints, hard delete + cascade, audit row, two migrations, two new secrets, PRD/README docs.

**Out of scope:** data export, soft-delete/grace-period/undo, admin or bulk deletion, IP-level rate-limiting infra, collapsing the two-email flow.

## Architecture / Approach

Two Supabase clients: the existing anon SSR client for normal calls, and a new server-only service-role admin client (`src/lib/supabaseAdmin.ts`, Workers-bound fetch, no session) used exclusively for token-table access and `deleteUser`. Flow: `request` (OTP send, throttled) → `verify` (verify OTP, mint hashed token, email link via `src/lib/services/email.ts`) → confirm page → `execute` (consume token, write audit, hard delete, clear session). Token + audit tables have RLS enabled with no policies; only the service-role path touches them.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend foundation | Secrets, admin client, Resend service, 2 migrations | Workers/service-role fetch wiring; Resend domain not yet verified |
| 2. Request + re-auth + token | `request` + `verify` endpoints, hashed token, email link | Supabase OTP email 2/hr cap; correct hash-at-rest |
| 3. Confirm + execute | Confirm page + `execute` (hard delete, audit, session clear) | Irreversible delete; ordering (audit before delete) |
| 4. Settings UI | shadcn dropdown island in PublicNav | A11y/modal wiring; not breaking existing logout |
| 5. Docs & PRD | Right-to-erasure FR + env docs | Keeping docs truthful |

**Prerequisites:** Resend account + verified sending domain; `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` in `.dev.vars` (and prod secrets/CI).
**Estimated effort:** ~3-4 sessions across 5 phases.

## Open Risks & Assumptions

- **Two-email flow is intentional** (OTP re-auth code + Resend confirmation link); accepted UX cost, collapsible later if it feels heavy.
- Resend sending fails silently until the domain is verified — Phase 1 manual check gates this.
- Supabase OTP re-auth is capped at 2 emails/hr; surface a clear throttle message.
- Deleting a user does not invalidate existing JWTs — we clear the local session and lean on short token expiry.

## Success Criteria (Summary)

- A user can complete Settings → OTP → email link → confirm → deletion, ending signed-out on a goodbye page.
- After confirmation, the `auth.users` row and all plans/aid_stations/gear/selections are gone, with one surviving audit row.
- Confirmation links are single-use and expire in 30 minutes; expired/used/garbage tokens never delete anything.

---
date: 2026-06-19T12:04:54Z
researcher: Claude (Opus 4.8)
git_commit: 828dc7b3d46913c7f50675c9d41c0475fad22873
branch: feature/account-deletion
repository: bchojnicki/ultra-planner
topic: "Self-service account deletion: service-role delete, email confirmation, Settings UI, data cascade"
tags: [research, codebase, account-deletion, supabase-admin, service-role, email-confirmation, cloudflare-workers, rls]
status: complete
last_updated: 2026-06-19
last_updated_by: Claude (Opus 4.8)
---

# Research: Self-service Account Deletion

**Date**: 2026-06-19T12:04:54Z
**Researcher**: Claude (Opus 4.8)
**Git Commit**: 828dc7b3d46913c7f50675c9d41c0475fad22873
**Branch**: feature/account-deletion
**Repository**: bchojnicki/ultra-planner

## Research Question

Resolve the open unknowns for the `account-deletion` change (see `context/changes/account-deletion/change.md`): how to permanently delete the authenticated user's account (which must cascade all their data), how to confirm the destructive action by an emailed link, and how to surface a Settings roll-out menu (Logout + destructive Remove account) in the SSR nav. Scope: codebase mapping **plus** web verification of the Supabase admin API + service-role usage on Cloudflare Workers.

## Summary

The work decomposes into four findings, three of them now settled:

1. **Data cascade — SOLVED, verified.** Deleting the `auth.users` row removes all connected data automatically via `ON DELETE CASCADE`. The chain is fully wired in existing migrations. **No app-level cascade code is needed.** The delete must be a **hard** delete (the supabase-js default) — a soft delete leaves the `auth.users` row intact and the cascade never fires.

2. **Service-role delete — clear path, secret must be added.** `supabase.auth.admin.deleteUser(id)` **requires the `service_role` key**, which the app does NOT currently have wired (the SSR client uses the anon `SUPABASE_KEY`). The exact pattern to add a server-only secret + an admin client already exists in the integration tests and can be lifted directly. ⚠️ Two sub-agents initially assumed the current `SUPABASE_KEY` could perform admin ops — that is **incorrect**; admin methods need a distinct service-role key.

3. **Email confirmation — needs a decision + likely a new mailer.** The only email path wired today is Supabase Auth's built-in OTP email (`signInWithOtp`/`verifyOtp`). There is **no transactional email provider** (no Resend/SendGrid/etc.). Supabase's built-in auth emails can only carry the fixed auth-template links, and `generateLink()` has **no link type for an arbitrary "delete account" action**. So a fully custom confirmation link effectively requires either (a) a custom token table + an external mailer (e.g. Resend), or (b) repurposing the OTP/magic-link flow (simpler, weaker semantics).

4. **Settings UI — straightforward, one new component.** The nav (`PublicNav.astro`) is auth-aware and currently hosts a form-based Sign out. A small React island (`client:load`, matching existing islands) replaces it. `dropdown-menu` is **not** installed in `src/components/ui/`, but Radix is already a dependency, and a `destructive` button variant already exists.

## Detailed Findings

### Area 1 — Data cascade (VERIFIED: deleting the auth user is sufficient)

The cascade claim from `change.md` is **100% confirmed** with exact constraint lines:

- Root: `plans.user_id uuid not null references auth.users (id) on delete cascade` — [`supabase/migrations/20260603132423_create_plans_and_aid_stations.sql:24`](https://github.com/bchojnicki/ultra-planner/blob/828dc7b3d46913c7f50675c9d41c0475fad22873/supabase/migrations/20260603132423_create_plans_and_aid_stations.sql#L24)
- `aid_stations.plan_id references plans (id) on delete cascade` — [`…20260603132423…sql:52`](https://github.com/bchojnicki/ultra-planner/blob/828dc7b3d46913c7f50675c9d41c0475fad22873/supabase/migrations/20260603132423_create_plans_and_aid_stations.sql#L52)
- `gear_items.plan_id references plans (id) on delete cascade` — [`supabase/migrations/20260616073640_create_gear_items.sql:24`](https://github.com/bchojnicki/ultra-planner/blob/828dc7b3d46913c7f50675c9d41c0475fad22873/supabase/migrations/20260616073640_create_gear_items.sql#L24)
- `gear_segment_selections.plan_id` + `gear_item_id`, both `on delete cascade` — [`supabase/migrations/20260616073641_create_gear_segment_selections.sql:23-24`](https://github.com/bchojnicki/ultra-planner/blob/828dc7b3d46913c7f50675c9d41c0475fad22873/supabase/migrations/20260616073641_create_gear_segment_selections.sql#L23-L24)
- Composite-FK consistency, also cascading — [`supabase/migrations/20260616073642_enforce_gear_selection_plan_consistency.sql:17`](https://github.com/bchojnicki/ultra-planner/blob/828dc7b3d46913c7f50675c9d41c0475fad22873/supabase/migrations/20260616073642_enforce_gear_selection_plan_consistency.sql#L17)

**Cascade path:** `auth.users(id)` → `plans(user_id)` → `{aid_stations, gear_items}(plan_id)` → `gear_segment_selections(plan_id, gear_item_id)`.

**Critical web-research caveat:** the cascade only fires on a **hard** delete. `deleteUser(id, shouldSoftDelete?)` defaults `shouldSoftDelete` to `false` (hard delete → `auth.users` row removed → cascade fires). Passing `true` keeps the row (audit-friendly) but **orphans/retains all app data** — not what "permanently delete" wants. Use the default hard delete.

### Area 2 — Service-role admin delete (pattern exists in tests; secret must be added)

Current SSR client uses the **anon** key, per-request, with cookie callbacks:
- [`src/lib/supabase.ts:1-24`](https://github.com/bchojnicki/ultra-planner/blob/828dc7b3d46913c7f50675c9d41c0475fad22873/src/lib/supabase.ts#L1-L24) — `createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, { cookies: … })`, imports from `astro:env/server`, returns `null` if unset.
- Env schema declares only `SUPABASE_URL` + `SUPABASE_KEY` as `context: "server", access: "secret", optional: true` — [`astro.config.mjs:16-22`](https://github.com/bchojnicki/ultra-planner/blob/828dc7b3d46913c7f50675c9d41c0475fad22873/astro.config.mjs#L16-L22).
- Middleware resolves `context.locals.user` via `supabase.auth.getUser()` and guards `PROTECTED_ROUTES` (`/dashboard`, `/plans`) — [`src/middleware.ts:4-24`](https://github.com/bchojnicki/ultra-planner/blob/828dc7b3d46913c7f50675c9d41c0475fad22873/src/middleware.ts#L4-L24).

**The admin pattern already exists in the integration tests** — lift it directly:
- `createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })` and `admin.auth.admin.deleteUser(userId)` — `tests/integration/rls-ownership.test.ts:81-83,139` (also used in `gpx-import-flow.test.ts:34`, `plans-flow.test.ts:34`, `gear-flow.test.ts`). Tests read `process.env.SUPABASE_SERVICE_ROLE_KEY` with a hardcoded local-CLI default.

**Web-verified admin facts (Supabase docs, fetched 2026-06-19; supabase-js v2, all GA — not beta):**
- `deleteUser` "Requires a `service_role` key" and "should only be called on a server. Never expose your `service_role` key in the browser."
- Deleting a user **does not invalidate existing access tokens** → sign the user out / revoke sessions at deletion; keep JWT expiry short.
- supabase-js v2 runs on Workers because admin REST calls (`/auth/v1/admin/*`) are plain `fetch` (no Node APIs, no websockets). Use a **dedicated** admin client (not the `@supabase/ssr` one), disable session persistence, and bind the Workers global fetch.

**Canonical pattern to add the secret (matches existing conventions):**
1. `astro.config.mjs` env.schema: add `SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true })`.
2. New server-only helper (e.g. `src/lib/supabaseAdmin.ts`, never imported by an island):
   ```ts
   import { createClient } from "@supabase/supabase-js"; // NOT @supabase/ssr
   import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
   export function createAdminClient() {
     return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
       auth: { autoRefreshToken: false, persistSession: false },
       global: { fetch: fetch.bind(globalThis) }, // Workers global fetch
     });
   }
   ```
3. Local: add `SUPABASE_SERVICE_ROLE_KEY=…` to `.dev.vars` (gitignored — [`.gitignore:21`](https://github.com/bchojnicki/ultra-planner/blob/828dc7b3d46913c7f50675c9d41c0475fad22873/.gitignore#L21)). Prod: `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`. CI: add as a GitHub repo secret (README documents the URL/KEY equivalents at README.md:167-171).

**Workers gotchas:** no global `process.env` in the Worker runtime — use `astro:env/server`; `astro:env` validates at build time; instantiate the admin client per-request (short-lived isolates), don't hold the secret in a module-global singleton across requests.

### Area 3 — Email confirmation mechanism (decision required)

Inventory of email capability **today**:
- Only path = Supabase Auth built-in OTP email. `signInWithOtp({ email, shouldCreateUser: true })` — `src/pages/api/auth/request-code.ts:25`; `verifyOtp({ email, token, type: "email" })` — `src/pages/api/auth/verify-code.ts:25`.
- Config: `otp_length = 6`, `otp_expiry = 3600`, `max_frequency = "1s"`, `rate_limit.email_sent = 2`/hr — `supabase/config.toml:182,213-217`. Local email captured by Mailpit on 54324; SMTP block is commented out (`config.toml:219-227`).
- **No external mailer** in deps (no `resend`/`sendgrid`/`nodemailer`/`postmark`).
- Migration convention for a new table: header comment + `enable row level security` + one policy per operation, `YYYYMMDDHHmmss_*.sql` naming (CLAUDE.md:40; mirror `20260603132423_*`).

Three options (web-verified constraints folded in):

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. `auth.admin.generateLink()`** | Service-role generates an auth `action_link` (`magiclink`/`recovery`/etc.) | Native, returns `action_link`+`hashed_token`; no table | **No "delete" link type** — every type is an auth action that logs the user in / resets password; doesn't encode delete intent; *generateLink only returns the link — it does NOT send the email* (still needs a mailer) |
| **B. Custom token table + external mailer (recommended for correctness)** | New `account_deletion_tokens` table storing a **hash** of a high-entropy token, `user_id`, `expires_at` (~30 min), `used_at`; raw token emailed via Resend; confirm endpoint hashes param, validates, hard-deletes, marks `used_at` | Encodes delete intent exactly; single-use + short expiry + user-scoped by construction; hash-at-rest; clean UX; matches existing RLS/migration style | Requires a transactional email provider (Resend = HTTP API, Workers-friendly) + a new table + endpoint |
| **C. Reuse OTP / magic-link** | Send a code via existing Supabase email; on verify, run the delete | No new table, no new mailer, minimal code | Wrong semantics (a *sign-in* primitive used as a delete confirmation); intent lives only in server state, not bound to the token; "we emailed you a sign-in code" UX is confusing for deletion |

**Note:** Built-in Supabase auth emails are limited to auth-template variables (`{{ .ConfirmationURL }}`, …) — you **cannot** drop an arbitrary `/account/delete/confirm?token=…` link into them. That is the core reason Option B needs an external mailer. The genuine trade-off for planning: **Option B (correctness, +Resend dependency) vs Option C (minimal, weaker semantics, no new dependency)**. Decide in `/10x-plan`.

### Area 4 — Settings UI + API route conventions

- Nav is auth-aware: reads `Astro.locals.user`, logged-out → "Sign in", logged-in → "Dashboard" + a `<form method="POST" action="/api/auth/signout">` Sign out — `src/components/public/PublicNav.astro:4-5,19-41`. **Replace the inline Sign out form (lines 24-31)** with a new `SettingsMenu` island.
- React islands use `client:load` (e.g. `dashboard.astro:25`, `auth/signin.astro:25`). Hooks live in `src/components/hooks/` (`useAutosave.ts`).
- shadcn config `components.json`: "new-york", lucide icons, `@/components/ui`. Installed UI: `button.tsx` (has a `destructive` variant — use it for "Remove account"), `tooltip.tsx`, `HelpTooltip.tsx`. **`dropdown-menu` is NOT installed.** Options: `npx shadcn@latest add dropdown-menu` (Radix already a dep, `radix-ui ^1.6.0`), use Radix directly, or a low-JS `<details>` disclosure.
- `cn()` = `twMerge(clsx(...))` — `src/lib/utils.ts`.

**Canonical API-route skeleton** (from `src/pages/api/plans/[id].ts`, `src/pages/api/aid-stations/[id].ts`, `src/pages/api/auth/signout.ts`):
```ts
import type { APIRoute } from "astro";
export const prerender = false;
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });
  // … validate input with zod, do work, map errors …
  return new Response(null, { status: 204 });
};
```
Error-mapping convention: `42501` (RLS) → 403, `PGRST116` (no rows) → 404, else 500 (`aid-stations/[id].ts:35-43`). RLS makes a delete of a non-owned id an idempotent no-op (still 204).

⚠️ **Correction to two sub-agents' suggested skeleton:** they wrote `await supabase.auth.admin.deleteUser(user.id)` on the **SSR/anon** client. That will fail — `admin.*` needs the **service-role** admin client from Area 2, not the cookie-based SSR client.

## Code References

- `src/lib/supabase.ts:1-24` — SSR client (anon key, cookie callbacks)
- `astro.config.mjs:16-22` — Cloudflare adapter + env.schema (only URL/KEY today)
- `src/middleware.ts:4-24` — user resolution + PROTECTED_ROUTES
- `tests/integration/rls-ownership.test.ts:81-83,139` — **existing** service-role admin client + `admin.auth.admin.deleteUser`
- `src/pages/api/auth/request-code.ts:25` / `verify-code.ts:25` — only email path (OTP)
- `supabase/config.toml:182,213-227` — OTP/email config, commented-out SMTP, rate limits
- `supabase/migrations/20260603132423_create_plans_and_aid_stations.sql:24,52` — cascade root + plans RLS pattern
- `supabase/migrations/20260616073640…42` — downstream gear cascades
- `src/components/public/PublicNav.astro:24-31` — Sign out form to replace with Settings menu
- `src/components/ui/button.tsx` — `destructive` variant available
- `src/pages/api/aid-stations/[id].ts:35-43` — error-code → status mapping convention

## Architecture Insights

- **Secrets discipline:** single source of truth is `astro:env/server`; never `process.env` in app code; secrets are `.gitignore`d (`.dev.vars` local, `wrangler secret put` prod, GitHub secrets for CI). Adding the service-role key follows this exact path.
- **Two distinct Supabase clients by purpose:** cookie-bound `@supabase/ssr` `createServerClient` (anon, per-request, user-scoped, RLS-enforced) for normal app calls; and a server-only `@supabase/supabase-js` `createClient` (service-role, no session) strictly for admin ops. Keep them in separate modules so the service-role one can never be pulled into a client island.
- **RLS-everywhere posture (CLAUDE.md):** one policy per operation, never `FOR ALL`/`USING (true)` on user data. Any new `account_deletion_tokens` table must follow this; the token-validation path runs as `service_role`.
- **Destructive-action posture:** hard delete is irreversible; the cascade is wide. The email-link guard + single-use/short-expiry token + re-auth + session revocation + an audit row that is *not* FK-cascaded to `auth.users` are the safety rails.

## Historical Context (from prior changes)

- `context/changes/account-deletion/change.md` — the originating change note already diagnosed the three unknowns and pre-confirmed the cascade finding; this research validates all of it and corrects the assumption that the current `SUPABASE_KEY` is admin-capable.
- Sibling post-MVP changes (`excel-export/`, `gear-total-summary/`, `collapsible-plan-sections/`) were UX-only; account deletion is the first **account-lifecycle / privacy** capability — `change.md` flags it likely warrants a PRD FR addition (raise in `/10x-plan`).

## Related Research

- None prior for this topic. This is the first `research.md` under `context/changes/account-deletion/`.

## Open Questions (resolve in `/10x-plan`)

1. **Email mechanism decision (Option B vs C).** Adopt a transactional mailer (Resend) for a true single-use delete-confirmation link (B), or reuse the OTP/magic-link primitive to avoid a new dependency (C)? This is the one genuine product/architecture fork.
2. **Soft vs hard delete + audit.** Confirm hard delete (default) for full purge; decide whether to also write an audit record (and where, so it survives the cascade — not FK'd to `auth.users`).
3. **Re-authentication strength.** Require fresh password/`reauthenticate()` before issuing the deletion request, or accept the existing session? (Web research recommends re-auth + session revocation since tokens aren't auto-invalidated.)
4. **Rate limiting on the request endpoint** (per-user + per-IP) on Workers — KV / Durable Object counter or Cloudflare rate-limit rule.
5. **Settings dropdown implementation** — `shadcn dropdown-menu` (extra component, accessible, keyboard nav) vs native `<details>` (zero new deps). Trade ergonomics vs surface area.
6. **PRD FR addition** — should account deletion / right-to-erasure be added to `context/foundation/prd.md`?

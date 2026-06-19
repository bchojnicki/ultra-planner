---
change_id: account-deletion
title: Self-service account deletion (email-confirmed, cascades all user data)
created: 2026-06-19
updated: 2026-06-19
status: new
archived_at: null
---

## Notes

Feature (reported 2026-06-19): a logged-in user can permanently delete their account, which removes all their connected data (plans, aid stations, gear, gear selections).

**Requirements:**

- **UI:** a **Settings** button that opens a roll-out menu with **Logout** and **Remove account** (the latter styled red / destructive).
- **Confirmation by email:** deleting must be confirmed — send a link to the user's email; the account is only removed after they click it. (Destructive + irreversible → email is the guard.)
- **Cascade:** removing the account deletes all connected plans, gear, aid stations, selections.

**Key finding (data cascade already solved):** the schema already cascades from the auth user. `plans.user_id → auth.users(id) ON DELETE CASCADE` (`supabase/migrations/20260603132423_*.sql:24`), and `aid_stations`/`gear_items`/`gear_segment_selections` all `→ plans(id) ON DELETE CASCADE`. So **deleting the `auth.users` row removes every connected row automatically** — no app-level cascade needed. The work is: delete the auth user + the email-confirm flow + the Settings UI.

**Open unknowns (resolve in research/plan):**

1. **Deleting the auth user needs the admin API.** `supabase.auth.admin.deleteUser(id)` requires the **service-role key**; the app currently uses `SUPABASE_KEY` (anon) for the SSR client (`src/lib/supabase.ts`, `astro.config.mjs` env schema). Need a server-only admin client + a service-role secret (`.dev.vars` / Cloudflare secret) — verify what's available and the Workers constraints.
2. **Email-link mechanism.** No transactional email is wired beyond Supabase auth OTP (`src/pages/api/auth/request-code.ts` → `signInWithOtp`). Options to research: Supabase admin `generateLink`, a custom signed/expiring single-use token table emailed via the existing path, or reusing the OTP verify flow as the confirmation. Token must be single-use, expiring, user-scoped; rate-limit the request.
3. **Settings dropdown is interactive.** The shared nav (`PublicNav.astro`) is SSR `.astro`; a roll-out menu needs a small React island (shadcn `dropdown-menu`) or a `<details>` disclosure. Decide placement (in PublicNav, shown only when logged in).

**PRD:** account deletion / right-to-erasure is a real account-lifecycle + privacy capability — likely warrants a PRD FR addition (unlike the prior UX-only changes). Flag during planning.

**Suggested next step:** `/10x-research account-deletion` first (two real unknowns: admin/service-role delete + email-link mechanism), then `/10x-plan`. Security-sensitive; the destructive path must be confirmed and irreversible-by-accident.

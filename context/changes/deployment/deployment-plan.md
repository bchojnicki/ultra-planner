# Cloudflare Workers Integration & Deployment Plan

## Context

The project is already bootstrapped for Cloudflare Workers (`@astrojs/cloudflare` v13.5.0, `wrangler.jsonc` present), but several gaps block a production-ready deploy:

1. **Critical bug**: `wrangler.jsonc` is missing `disable_nodejs_process_v2` in `compatibility_flags` — without it, workerd returns `AsyncIterable` instead of `ReadableStream` for SSR responses, silently breaking page rendering (astro#15434).
2. **Wrong worker name**: `wrangler.jsonc` still uses the starter name `10x-astro-starter` instead of `ultra-planner`.
3. **No secrets set** in Cloudflare Workers (Supabase URL/key).
4. **No deploy CI/CD**: `ci.yml` only lints/builds; no Wrangler deploy step exists.
5. **Branch inconsistency**: `ci.yml` targets `master`, `playwright.yml` targets `[main, master]`; the repo's main branch is `main`.

The plan below walks through every phase in dependency order, separating automated edits from human-gated steps (marked ⚠️ User action).

---

## Phase 1 — Fix `wrangler.jsonc` (config corrections) ✅

- [x] **1.1** Add `disable_nodejs_process_v2` to `compatibility_flags`:

  ```json
  "compatibility_flags": ["nodejs_compat", "disable_nodejs_process_v2"]
  ```

  _File_: `wrangler.jsonc`

- [x] **1.2** Rename worker from `10x-astro-starter` → `ultra-planner`:
  ```json
  "name": "ultra-planner"
  ```
  _File_: `wrangler.jsonc` — determines the Worker URL and secret namespace in Cloudflare dashboard.

---

## Phase 2 — Cloudflare Authentication ⚠️ User action

Steps requiring interactive terminal commands (run with `! <command>` in the prompt):

- [x] **2.1** Authenticate with Cloudflare:

  ```bash
  npx wrangler login
  ```

  Opens browser OAuth flow. Credentials are stored in `~/.wrangler/config`.

- [x] **2.2** Verify auth and capture `account_id`:

  ```bash
  npx wrangler whoami
  ```

  Copy the **Account ID** from the output.

- [x] **2.3** Add `account_id` to `wrangler.jsonc`:
  ```json
  "account_id": "<YOUR_ACCOUNT_ID>"
  ```
  This is not secret; it's safe to commit.

---

## Phase 3 — Local Dev Setup ⚠️ User action

- [x] **3.1** Create `.dev.vars` for local Cloudflare dev (gitignored):

  ```
  SUPABASE_URL=<your-supabase-url>
  SUPABASE_KEY=<your-supabase-anon-key>
  ```

  Source values from your Supabase dashboard (Project Settings → API).

- [ ] **3.2** Verify `wrangler dev` starts cleanly:
  ```bash
  npx wrangler dev
  ```
  Must start without errors. If `AsyncIterable` errors appear, the Phase 1 flag fix was not applied.

---

## Phase 4 — Auth Flow Validation (wrangler dev, not astro dev)

> ⚠️ The infrastructure.md pre-mortem flags that Supabase SSR cookie failures only appear in `wrangler dev` or production — not in `astro dev`. This phase must use `wrangler dev`.

- [ ] **4.1** Test sign-up flow end-to-end:
  - Navigate to `/auth/signup`, register a test user, confirm email.

- [ ] **4.2** Test sign-in → redirect → session read:
  - Sign in → confirm redirect to `/dashboard` works.
  - Refresh — confirm session persists (cookie roundtrip through Workers).

- [ ] **4.3** Test protected route without session:
  - Clear cookies, navigate to `/dashboard` — confirm redirect to `/auth/signin`.

- [ ] **4.4** Check `wrangler tail` output during auth steps for errors:
  ```bash
  npx wrangler tail --status error
  ```

_Note on cookie compatibility_: `src/lib/supabase.ts` uses Astro's `cookies.set()` API (not direct `Response` header mutation), which is Workers-compatible. Astro finalizes cookie headers before the response is constructed. No code change expected here.

---

## Phase 5 — Set Production Secrets ⚠️ User action

Secrets are encrypted at rest; only the Worker at runtime can read them. Run each command and paste the value when prompted:

- [ ] **5.1**

  ```bash
  npx wrangler secret put SUPABASE_URL
  ```

- [ ] **5.2**

  ```bash
  npx wrangler secret put SUPABASE_KEY
  ```

- [ ] **5.3** Verify secrets are registered:
  ```bash
  npx wrangler secret list
  ```
  Both `SUPABASE_URL` and `SUPABASE_KEY` should appear.

---

## Phase 6 — Build & Deploy

- [ ] **6.1** Production build:

  ```bash
  npm run build
  ```

  Must complete without errors. CJS errors at this stage indicate a CommonJS package issue.

- [ ] **6.2** Deploy to Cloudflare Workers:

  ```bash
  npx wrangler deploy
  ```

  Wrangler prints the deployed Worker URL (e.g., `https://ultra-planner.<account>.workers.dev`).

- [ ] **6.3** Repeat Phase 4 auth tests against the live Worker URL (not localhost).

- [ ] **6.4** Monitor live logs for errors:
  ```bash
  npx wrangler tail --status error
  ```

---

## Phase 7 — CI/CD Deployment Workflow ✅

### 7.1 Fix branch inconsistency in existing workflows ✅

- [x] Updated `ci.yml` trigger to include `main`:
      _File_: `.github/workflows/ci.yml`

- [x] Standardized Node.js version in `playwright.yml` from `lts/*` to `22`.
      _File_: `.github/workflows/playwright.yml`

### 7.2 Create deploy workflow ✅

- [x] Created `.github/workflows/deploy.yml` — deploys on push to `main`/`master`.

### 7.3 Add GitHub repository secrets ⚠️ User action

In GitHub → repo → Settings → Secrets → Actions, add:

| Secret name             | Where to get it                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | From `npx wrangler whoami` output (Phase 2)                                                        |
| `SUPABASE_URL`          | Supabase dashboard → Project Settings → API                                                        |
| `SUPABASE_KEY`          | Supabase dashboard → Project Settings → API                                                        |

_Note_: `SUPABASE_URL` and `SUPABASE_KEY` are needed in CI build steps. They are already referenced in `ci.yml`.

### 7.4 Branch protection recommendation (optional)

Configure `main` branch to require `ci` job to pass before merging — prevents a broken build from being auto-deployed.

---

## Files Modified

| File                               | Change                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `wrangler.jsonc`                   | ✅ Added `disable_nodejs_process_v2` flag, renamed worker — pending `account_id` |
| `.github/workflows/ci.yml`         | ✅ Added `main` to branch triggers                                               |
| `.github/workflows/playwright.yml` | ✅ Pinned Node to `22`                                                           |
| `.github/workflows/deploy.yml`     | ✅ New file — Wrangler deploy on push to main/master                             |

---

## Verification Checklist

- [ ] `npx wrangler dev` starts without AsyncIterable errors
- [ ] Full auth flow (signup → signin → session → protected route) works via `wrangler dev`
- [ ] `npx wrangler secret list` shows both secrets
- [ ] `npm run build && npx wrangler deploy` succeeds, Worker URL is accessible
- [ ] Auth flow works on the live Worker URL
- [ ] GitHub Actions `deploy.yml` triggers on push to `main` and deploys successfully
- [ ] `npx wrangler tail` shows no errors during normal usage

---

## Risk Mitigations (from infrastructure.md)

| Risk                                           | Mitigation in this plan                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Missing `disable_nodejs_process_v2` breaks SSR | Phase 1.1 — fixed ✅                                                                |
| Supabase cookie failures on Workers redirect   | Phase 4 — dedicated `wrangler dev` auth testing before production deploy            |
| CJS NPM dependency breaks at runtime           | Build errors in Phase 6.1 will surface most cases; audit new packages before adding |
| `astro dev` vs `wrangler dev` env mismatch     | Phase 4 explicitly uses `wrangler dev`                                              |

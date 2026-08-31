---
project: Ultra Planner
platform: Cloudflare Workers
created_at: 2026-06-19
status: ready-to-execute
source: context/foundation/infrastructure.md + context/foundation/tech-stack.md
---

# Deploy Plan — Ultra Planner → Cloudflare Workers

The "what is supposed to happen" runbook for the first production deploy. Platform
decision is locked in [`infrastructure.md`](../foundation/infrastructure.md)
(Cloudflare Workers). This plan covers the three production services the app needs —
hosted **Supabase**, verified **Resend** domain, **Cloudflare** Worker + custom
domain — plus the CI/CD workflow that automates redeploys.

## Current state (verified 2026-06-19)

- `wrangler.jsonc` correctly configured: entrypoint `@astrojs/cloudflare/entrypoints/server`,
  `compatibility_date: 2026-05-08`, flags `["nodejs_compat", "disable_nodejs_process_v2"]`,
  observability on, `account_id` set. **No config change needed.**
- `.dev.vars` points at **local** Supabase (`http://127.0.0.1:54321`) and Resend
  **sandbox** sender (`onboarding@resend.dev`). Both must be replaced with production
  values that live in Cloudflare Worker Secrets (never committed).
- App reads **5** runtime secrets (astro.config.mjs `env.schema`):
  `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
  `RESEND_FROM_EMAIL`.
- `.github/workflows/deploy.yml` deploys to Workers on push to `main` (lint → build → deploy).

## Secret topology (important)

Two different secret stores, do not confuse them:

| Where | Holds | Set by | Used when |
|---|---|---|---|
| **Cloudflare Worker Secrets** | all 5 app runtime secrets | `wrangler secret put` (once, manually) | every request at runtime |
| **GitHub Actions repo secrets** | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (+ `SUPABASE_URL`/`SUPABASE_KEY` for build) | repo Settings → Secrets | CI deploy step |

CI **does not** push app secrets — `wrangler deploy` ships code only; the 5 app secrets
persist in Cloudflare across deploys. Set them once in Step 3 and forget them.

---

## Manual gates (human-only — agent cannot do these)

These need your browser / accounts and are required before first deploy:

- [ ] **G1** — Buy the domain (`yourdomain.com`).
- [ ] **G2** — Add the domain as a zone in Cloudflare; point registrar nameservers at Cloudflare.
- [ ] **G3** — Create the hosted Supabase project (EU region).
- [ ] **G4** — Verify the sending domain in Resend (SPF/DKIM DNS records).
- [ ] **G5** — Create a scoped Cloudflare API token (Workers Scripts: Edit) for CI.

---

## Steps

### Step 1 — Production Supabase
```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push          # forward-only; migrations do NOT auto-rollback
```
Then in the Supabase dashboard:
- **Settings → API**: copy Project URL, publishable/anon key, service-role key.
- **Auth → URL Configuration**: Site URL = `https://yourdomain.com`; add it to Redirect URLs.
  (Local `supabase/config.toml` `site_url` is local-only and does NOT sync to the hosted project.)

### Step 2 — Resend production sender
- Resend → Domains → add `yourdomain.com`, create the DNS records, wait for verified.
- Production `RESEND_FROM_EMAIL` becomes e.g. `noreply@yourdomain.com`.
- Keep or mint a production `RESEND_API_KEY`.

### Step 3 — Cloudflare Worker secrets (once)
```bash
npx wrangler login
npx wrangler secret put SUPABASE_URL                # prod project URL
npx wrangler secret put SUPABASE_KEY                # prod publishable/anon key
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # prod service-role key
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM_EMAIL           # noreply@yourdomain.com
```

### Step 4 — First deploy (manual, to validate before CI owns it)
```bash
npm run lint && npm run build
npx wrangler deploy
```
Wrangler prints the `*.workers.dev` URL. Smoke-test on **that URL** (workerd runtime,
not `astro dev` — the infra pre-mortem flags Supabase SSR cookie bugs that only show on
workerd): sign up → confirm email → sign in → create plan → export to Excel.

### Step 5 — Custom domain
Cloudflare dashboard → Workers & Pages → `ultra-planner` → Settings →
Domains & Routes → Add custom domain → `yourdomain.com`. Cert + routing auto-provision.
Re-confirm Supabase Site URL / Redirect URLs match the final domain (Step 1).

### Step 6 — Enable CI auto-deploy
Add repo secrets (Settings → Secrets and variables → Actions):
- `CLOUDFLARE_API_TOKEN` (from G5, scoped: Workers Scripts → Edit)
- `CLOUDFLARE_ACCOUNT_ID` (`5a99ca2bc716ba9395c0e6df14595fbf`)
- `SUPABASE_URL`, `SUPABASE_KEY` (for the build step)

After this, every push to `main` runs `.github/workflows/deploy.yml` (lint → build →
`wrangler deploy`). `workflow_dispatch` allows manual runs from the Actions tab.

---

## Verify & operate
```bash
npx wrangler tail --status error    # live error stream
npx wrangler rollback               # revert to previous version (<30s)
npx wrangler versions list          # list deployed versions
```
Run the full auth + plan + export flow on `https://yourdomain.com` after Step 5.

## Approval boundary (from infrastructure.md)
Agent may run `wrangler deploy` / `wrangler tail` unattended. **Human approval required**
before: rotating production `SUPABASE_KEY`/service-role, running Supabase migrations
against prod, or Cloudflare billing-tier changes.

## Open decisions
- Domain on Cloudflare nameservers (recommended, makes Step 5 one click) vs. stay at registrar.
- CI gating: current deploy.yml runs lint+build itself but does not wait on the separate
  `playwright.yml`. If you want e2e to gate deploys, switch to a `workflow_run` trigger.

---
starter_id: 10x-astro-starter
package_manager: npm
project_name: ultra-planner
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Ultra Planner is a solo-built web app with a 3-week MVP window, built after hours. It requires auth (FR-001, FR-002 — passwordless email one-time code / OTP), a server-side database for plan persistence (FR-008, FR-009, FR-011), and must be fully usable on desktop and mobile without a native install. The `10x-astro-starter` is the recommended default for `(web-app, js)` and clears all four agent-friendly gates: typed (TypeScript + Zod throughout), convention-based (Astro file routing + Supabase conventions), popular in training data, and well-documented. Supabase covers auth (including passwordless one-time codes via `supabase.auth.signInWithOtp` + `verifyOtp`) and PostgreSQL persistence with row-level security — a direct match for the plan-ownership requirement. Cloudflare Pages is the starter's default deploy target; GitHub Actions with auto-deploy-on-merge is the CI shape. Bootstrapper confidence is first-class — the CLI is registered and expected to work, with occasional manual steps possible.

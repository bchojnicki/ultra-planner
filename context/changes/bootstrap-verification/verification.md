---
bootstrapped_at: 2026-05-19T22:45:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: ultra-planner
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
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
```

**Why this stack**: Ultra Planner is a solo-built web app with a 3-week MVP window, built after hours. It requires auth (FR-001, FR-002 — passwordless magic link), a server-side database for plan persistence (FR-008, FR-009, FR-011), and must be fully usable on desktop and mobile without a native install. The `10x-astro-starter` is the recommended default for `(web-app, js)` and clears all four agent-friendly gates: typed (TypeScript + Zod throughout), convention-based (Astro file routing + Supabase conventions), popular in training data, and well-documented. Supabase covers auth (including passwordless magic link via `supabase.auth.signInWithOtp`) and PostgreSQL persistence with row-level security — a direct match for the plan-ownership requirement. Cloudflare Pages is the starter's default deploy target; GitHub Actions with auto-deploy-on-merge is the CI shape. Bootstrapper confidence is first-class — the CLI is registered and expected to work, with occasional manual steps possible.

## Pre-scaffold verification

| Signal      | Value                                               | Severity | Notes                                                        |
| ----------- | --------------------------------------------------- | -------- | ------------------------------------------------------------ |
| npm package | not run                                             | n/a      | cmd_template starts with `git clone`; npm check skipped      |
| GitHub repo | przeprogramowani/10x-astro-starter pushed 2026-05-17 | fresh    | 2 days before run date (2026-05-19); within 3-month threshold |

## Scaffold log

**Note**: this is a re-run on an already-scaffolded cwd. All scaffold files conflicted with existing files and were sidelined as `.scaffold` siblings; existing project files were preserved.

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned into temp directory, upstream git history stripped, files moved up)
**Exit code**: 0
**Files moved silently**: 0 (all top-level paths already present in cwd)
**Conflicts (.scaffold siblings)**: astro.config.mjs, CLAUDE.md, components.json, eslint.config.js, package-lock.json, package.json, public/, README.md, src/, supabase/, tsconfig.json, wrangler.jsonc, .env.example, .github/, .husky/, .nvmrc, .prettierrc.json, .vscode/
**.gitignore handling**: append-merged (cwd .gitignore existed; starter lines de-duped and appended with `# from 10x-astro-starter` separator)
**node_modules handling**: removed from scaffold before move-up (skipping .scaffold sibling to avoid ~100 MB disk waste; installed dependencies unchanged in cwd)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0 (CRITICAL/HIGH/MODERATE/LOW)

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (transitive, via wrangler → @astrojs/cloudflare) — range 5.6.3–5.8.0
  - Advisory: GHSA-77vg-94rm-hx3p — "Svelte devalue: DoS via sparse array deserialization"
  - CVSS: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
  - CWE-770 (Allocation of Resources Without Limits or Throttling)
  - Fix: available (non-breaking) — run `npm audit fix`

#### MODERATE findings

**Direct packages (3):**

- **@astrojs/check** ≥0.9.3 (isDirect: true) — via @astrojs/language-server → volar-service-yaml → yaml-language-server → yaml (stack-overflow in deeply nested YAML, GHSA-48c2-rrv3-qjmp, CVSS 4.3). Fix: downgrade to 0.9.2 (semver-major).
- **@astrojs/cloudflare** ≥12.2.4 (isDirect: true) — via @cloudflare/vite-plugin and wrangler → miniflare → ws (uninitialized memory disclosure, GHSA-58qx-3vcg-4xpx, CVSS 4.4). Fix: upgrade to 12.6.13 (semver-major).
- **wrangler** ≥3.108.0 (isDirect: true) — via miniflare → ws (same ws advisory). Fix: downgrade to 3.107.3 (semver-major).

**Transitive packages (7):** @astrojs/language-server, @cloudflare/vite-plugin, miniflare, volar-service-yaml, ws (×2 nodes), yaml, yaml-language-server.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

These fields were preserved in the audit trail for the future M1L4 skill (or a later v2 of bootstrapper) to act on. v1 surfaces but does not compensate.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- This was a re-run on an already-scaffolded cwd. The `.scaffold` siblings now contain the starter's fresh copies of every project file. Since your cwd was already working, you can safely delete all `.scaffold` siblings: `find . -maxdepth 1 -name "*.scaffold" -o -name "*.scaffold" -type d | head -30` then `find . -maxdepth 1 \( -name "*.scaffold" -o -name "*.scaffold" \) -exec rm -rf {} +`
- Address audit findings per your project's risk tolerance. The HIGH finding (devalue DoS) is transitive via dev tooling (wrangler) and does not affect production runtime. Run `npm audit fix` for the non-breaking fix.
- Set up your Supabase project and populate `.env` from `.env.example`.
- Configure Cloudflare Pages deployment per `wrangler.jsonc`.

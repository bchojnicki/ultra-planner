---
project: "Ultra Planner"
researched_at: 2026-05-20
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 SSR
  runtime: Cloudflare Workers (workerd)
  adapter: "@astrojs/cloudflare v13.5.0"
  wrangler: "^4.90.0"
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare Workers is the only platform that requires zero adapter migration: the project already ships `@astrojs/cloudflare` v13.5.0 and a correctly configured `wrangler.jsonc`. Every other platform in the candidate pool requires swapping the adapter from `@astrojs/cloudflare` to `@astrojs/node` or a platform-specific equivalent — a non-trivial refactor on a 3-week MVP timeline. Cloudflare's free tier comfortably covers the expected 10k–100k monthly requests at $0, scoring highest on cost priority. The MCP ecosystem (GA Code Mode MCP, Claude Code integration, dedicated "Docs for Agents" portal) is the best-in-class for agent-driven development.

## Platform Comparison

| Platform | CLI-first | Managed | Agent docs | Deploy API | MCP | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **10** |
| Vercel | Pass | Pass | Pass | Pass | Partial | 9 |
| Netlify | Partial | Pass | Partial | Pass | Pass | 8 |
| Railway | Partial | Pass | Pass | Pass | Partial | 8 |
| Fly.io | Pass | Pass | Partial | Partial | Partial | 7 |
| Render | Fail | Pass | Pass | Partial | Partial | 6 |

**Scoring notes per platform:**

- **Cloudflare Workers**: Full `wrangler` CLI covers deploy, versioned rollback, and live log tailing. Docs published as `llms.txt` + `llms-full.txt` with a dedicated "Docs for Agents" portal. Deploy is one deterministic command with versioned rollback. GA Code Mode MCP exposes 2,500+ Cloudflare API endpoints and first-party Claude Code integration exists.
- **Vercel**: Loses one point on MCP — the Vercel MCP has been in public beta since August 2025 with no new tools added in 8+ months. Also requires adapter swap (`@astrojs/vercel`) and Hobby plan is technically non-commercial use only.
- **Netlify**: Loses a point on CLI (rollback is UI-only, no CLI command) and on docs (not published on GitHub as raw markdown, only `llms.txt`). GA MCP (`@netlify/mcp`) is a genuine strength. Cold starts of 800ms–1.5s are a concern for a low-QPS solo app. Requires adapter swap.
- **Railway**: Tied with Netlify at 8 but scores behind on cost ($5/month Hobby vs. free tiers above). CLI rollback is UI/API only. MCP is beta. Strong PaaS for Node.js containers.
- **Fly.io**: No free tier for new accounts (2024+), MCP is experimental, rollback requires manual image selection. Strong for persistent connections but overkill here.
- **Render**: No official CLI (deploy hooks + REST API only) is a hard miss on the CLI-first criterion. Free tier aggressively sleeps web services. MCP is read-mostly.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

The project was bootstrapped with the Cloudflare Workers target — `@astrojs/cloudflare` v13.5.0 is already installed, `wrangler.jsonc` is correctly configured with `main = "@astrojs/cloudflare/entrypoints/server"`, `nodejs_compat` is set, and `compatibility_date` is `2026-05-08` (well past the required `2024-09-23`). No adapter migration is needed. The free tier (100k requests/day) covers the MVP load at $0. The `wrangler` CLI covers the full operational loop: deploy, versioned rollback (`wrangler rollback`), and live log tailing (`wrangler tail`). Cloudflare has a first-party partnership with Anthropic and the most mature agent tooling of any platform in the candidate pool.

#### 2. Vercel

A strong second. Astro 6 SSR is GA via `@astrojs/vercel`, the CLI is comprehensive (including `vercel rollback` and `vercel bisect`), and docs are published as `llms.txt` + `llms-full.txt`. Would require swapping `@astrojs/cloudflare` for `@astrojs/vercel` and re-validating the Supabase SSR cookie flow on the Vercel Node.js runtime. The Hobby plan is free but restricted to non-commercial personal use — fine for a solo MVP in development, but worth noting before any commercial launch. Vercel MCP is beta (August 2025, unchanged since).

#### 3. Netlify

Netlify's GA MCP (`@netlify/mcp`, June 2025) is the most mature of the non-Cloudflare options. Free credit tier (300 credits/month) handles a low-QPS app easily. Would require swapping to `@astrojs/netlify`. The meaningful gaps versus the top two are: rollback is UI-only (no `netlify rollback` CLI command), cold starts of 800ms–1.5s on a low-QPS idle app, and the credit hard cap pauses the site rather than billing overages — no graceful degradation.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **CJS incompatibilities surface at runtime, not build time.** The workerd runtime has no CommonJS support. Any NPM package using `require()` internally will fail at runtime with an opaque error, not at `wrangler deploy` time. Transitive dependencies in date/math/utility libraries are the most common source. Supabase is well-tested on Workers; every new package added in future features carries this risk.
2. **`disable_nodejs_process_v2` is a required but non-obvious workaround.** Without this flag alongside `nodejs_compat`, workerd returns `AsyncIterable` from SSR responses instead of `ReadableStream`, silently breaking page rendering (GitHub issue [astro#15434](https://github.com/withastro/astro/issues/15434)). The project's current `wrangler.jsonc` does not yet include this flag.
3. **10ms CPU time limit on the free tier.** Free Workers get 10ms CPU per invocation. This excludes I/O wait (Supabase query time), so in practice the plan generation logic is likely fine. But if any future feature adds CPU-intensive computation, the limit will be hit silently — requests fail with a generic error.
4. **`deployment_target: cloudflare-pages` in tech-stack.md is stale.** Cloudflare Pages support was removed in `@astrojs/cloudflare` v13. The project is correctly configured for Workers, but the stack metadata contains a legacy label that could cause confusion for future contributors or tools.
5. **Vendor lock-in for the entire frontend runtime.** `cloudflare:workers` imports, workerd fetch semantics, and Wrangler bindings are all Cloudflare-specific. Future migration to any other platform requires rewriting the adapter layer and auditing runtime-touching code.

### Pre-Mortem — How This Could Fail

The Ultra Planner deployed to Cloudflare Workers successfully on day one. In week two, a session bug appeared: Supabase's `@supabase/ssr` cookie refresh worked correctly in `astro dev` (Node.js) but silently failed on Workers when the auth middleware attempted to write cookies on a redirect response. Workers' `Response` object is immutable after construction; the middleware had to be refactored to set cookies before the response was finalized. Diagnosing the root cause took two days because the behavior differed between `astro dev` and `wrangler dev`, and neither produced a clear error.

In week three, a utility library used for time formatting — pulled in by a gear profile calculation helper — contained a CommonJS `require()` call. The wrangler build succeeded; the error surfaced only in production when the bundle was loaded in workerd. The error message cited "module not found" rather than "CommonJS not supported," leading the developer to chase the wrong root cause for several hours.

The MVP shipped, but two weeks behind schedule. Both failures were workerd-vs-Node compatibility issues that are well-documented in hindsight but invisible in advance. The developer learned to audit every new package for CJS usage before adding it — an overhead that does not exist on a Node.js PaaS.

### Unknown Unknowns

- **`astro dev` and `wrangler dev` are different test environments.** `astro dev` runs on workerd in Astro 6, but `wrangler dev` is needed to test Wrangler bindings (secrets, Hyperdrive, KV) and the exact `wrangler.jsonc` configuration. Auth and cookie session bugs often only appear in `wrangler dev` or production, not `astro dev`.
- **Supabase SSR + Workers cookie lifecycle.** `@supabase/ssr` was designed for Node.js middleware. In Workers, cookies must be committed before the `Response` is returned. The existing `src/middleware.ts` needs testing specifically against Workers response semantics — not just Node.js behavior.
- **Free-tier CPU accounting excludes I/O.** The 10ms CPU limit counts only active computation, not time blocked on Supabase queries. The current plan generation algorithm (Naismith's rule across aid stations) is cheap; the limit is unlikely to bite in MVP. Understanding the distinction prevents false positives when profiling.
- **Wrangler 4.x docs diverge significantly from 3.x.** Many search results, Stack Overflow answers, and AI suggestions cite Wrangler 3.x syntax. `wrangler.toml` vs. `wrangler.jsonc`, the `main` entrypoint pattern, and the Pages-vs-Workers distinction are all areas where outdated docs mislead. Always verify against the Wrangler 4.68+ changelog.

## Operational Story

- **Preview deploys**: Run `npx wrangler versions upload` to upload a version without routing traffic, then promote with `npx wrangler versions deploy <id>:100%`. For branch previews in CI, use Wrangler's GitHub Action — preview URLs are scoped to the uploaded version and require no additional protection for non-production traffic.
- **Secrets**: Production env vars (`SUPABASE_URL`, `SUPABASE_KEY`) are stored in Cloudflare Workers Secrets via `npx wrangler secret put <NAME>`. Secrets are encrypted at rest; only the Worker at runtime can read them. Local dev uses `.dev.vars` (gitignored). Rotation: `npx wrangler secret put <NAME>` overwrites the current value atomically.
- **Rollback**: `npx wrangler rollback` reverts to the previous deployment. To target a specific version: `npx wrangler rollback <VERSION_ID>`. List versions with `npx wrangler versions list`. Typical time-to-revert is under 30 seconds. DB migrations (Supabase) do not roll back automatically — always run migrations as forward-only.
- **Approval**: An agent may run `npx wrangler deploy` and `npx wrangler tail` unattended. Human approval is required before: rotating the production `SUPABASE_KEY` secret, running Supabase migrations against the production DB, or billing-tier changes in the Cloudflare dashboard.
- **Logs**: `npx wrangler tail` streams live request logs, errors, and console output to the terminal. Filter with `--status error`, `--search <keyword>`, or `--format json`. Observability is enabled in `wrangler.jsonc` (`observability.enabled: true`), which routes logs to Cloudflare's Workers Observability dashboard as well.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| CJS NPM dependency breaks at runtime | Devil's advocate | M | H | Before adding any new package, check for `require()` in its source or run `npx cjs-module-lexer` against the bundle. Prefer ESM-native packages. |
| Missing `disable_nodejs_process_v2` flag breaks SSR responses | Devil's advocate | H | H | Add `"disable_nodejs_process_v2"` to `compatibility_flags` in `wrangler.jsonc` immediately (see Getting Started). |
| Supabase SSR cookie failure on Workers redirect | Pre-mortem | M | H | Test the full auth flow (request OTP code → `verifyOtp` → SSR session cookie read) via `wrangler dev`, not just `astro dev`. Cookie writes must occur before `Response` is constructed. |
| Free-tier CPU limit hit by future features | Devil's advocate | L | M | Monitor CPU-ms via Cloudflare dashboard. If approaching limits, upgrade to $5/month Workers Paid (30M CPU-ms/month). |
| `astro dev` vs `wrangler dev` env mismatch hides bugs | Unknown unknowns | M | M | Run `wrangler dev` for any test involving auth, secrets, or Supabase connectivity. Use `astro dev` only for fast UI iteration. |
| Stale `deployment_target: cloudflare-pages` metadata | Devil's advocate | L | L | Update `tech-stack.md` `deployment_target` field to `cloudflare-workers` to avoid confusion. |
| Vendor lock-in makes future platform migration costly | Devil's advocate | L | M | Acceptable for MVP scope. Isolate Cloudflare-specific code behind the adapter layer; avoid scattering `cloudflare:workers` imports across business logic. |

## Getting Started

The project is already bootstrapped for Workers — steps 1–2 confirm the existing config; steps 3–5 complete the pre-deploy setup.

1. **Add the missing compatibility flag.** Open `wrangler.jsonc` and add `"disable_nodejs_process_v2"` to `compatibility_flags`:
   ```json
   "compatibility_flags": ["nodejs_compat", "disable_nodejs_process_v2"]
   ```
   This prevents a known bug where workerd returns `AsyncIterable` instead of `ReadableStream` for SSR responses.

2. **Verify the entrypoint and date.** Confirm `wrangler.jsonc` contains:
   - `"main": "@astrojs/cloudflare/entrypoints/server"` (correct for v13+)
   - `"compatibility_date": "2024-09-23"` or later (already set to `2026-05-08` ✓)

3. **Authenticate with Cloudflare:**
   ```bash
   npx wrangler login
   ```

4. **Set production secrets:**
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```

5. **Build and deploy:**
   ```bash
   npm run build
   npx wrangler deploy
   ```
   Wrangler prints the deployed Worker URL. Verify auth flow end-to-end via `wrangler dev` before treating the deploy as stable.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions wrangler workflow)
- Production-scale architecture (multi-region, HA, DR)

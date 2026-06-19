# Public pages + mountain-outline brand Implementation Plan

## Overview

Replace the stock Astro "10x Astro Starter" landing with a custom public site for Ultra Planner, built on the **"Summit at first light"** design direction (`design-direction.md`): a ridgeline-hero welcome page, an About page (the wedge story), and a Contact page (mailto card), all on a shared auth-aware public layout. Post-login lands on `/dashboard` instead of the marketing page. The authenticated builder/dashboard and all data/API paths are untouched. This is additive marketing/UX — no PRD change (consistent with the `tooltips` precedent).

## Current State Analysis

- `src/pages/index.astro` renders `src/components/Welcome.astro` — the stock "10x Astro Starter" cosmic page (Topbar + gradient hero + 3 generic feature cards). This is the page to replace.
- `src/layouts/Layout.astro` is a generic HTML shell: imports `global.css`, renders a config-status `Banner`, then `<slot>`. The cosmic styling lives in `Welcome.astro`, not the layout — so the layout is reusable as the base `<html>` shell.
- `src/components/Topbar.astro` is already **auth-aware** (`Astro.locals.user`): shows email + Dashboard + Sign out when logged in, Sign in otherwise — in the app's glass style. It's the pattern to adapt for the public nav.
- `src/middleware.ts` gates only `PROTECTED_ROUTES = ["/dashboard", "/plans"]`. So `/`, `/about`, `/contact` are **already public** — no middleware change is needed; the pages just need to exist.
- Post-login redirect: `src/pages/api/auth/verify-code.ts:31` returns `context.redirect("/")`. Sign-out (`signout.ts:9`) also returns `/` (correct — sign-out landing).
- Fonts: Astro 6, Cloudflare adapter, Tailwind 4 via Vite plugin (`astro.config.mjs`), no `tailwind.config.ts`, **no font tooling**. Tailwind v4 theme tokens live in `src/styles/global.css` (the `@tailwindcss/vite` setup). The app sets no font-family (uses system default).
- The app's visual vocabulary to stay cohesive with: `white/10` borders, `backdrop-blur-xl`, rounded-2xl panels, `purple-400` focus rings, `blue-100/*` text tints.

### Key Discoveries:

- Design is pre-settled in `context/changes/public-pages-and-brand/design-direction.md` (palette, type roles, ridgeline signature, motion). Treat it as authoritative; this plan owns build structure, not aesthetics.
- `/about` and `/contact` need **no middleware edit** — they're outside `PROTECTED_ROUTES`.
- Tailwind v4 + Vite means design tokens are added as CSS custom properties / `@theme` in `src/styles/global.css`, not a JS config file (per CLAUDE.md: no `tailwind.config.ts`).
- Fonts self-hosted via `@fontsource` packages (npm), imported where the public pages load them — Cloudflare-safe (static font files, no external CDN dependency at runtime).
- The middleware always resolves `locals.user`, so the public nav can render Sign in vs Dashboard with zero extra wiring (same source as Topbar).

## Desired End State

Visiting `/` shows the custom Ultra Planner landing: a ridgeline hero that draws on load (sun rising behind the peak), the per-segment wedge stated once, a 3-step "how it works", and a single violet CTA to sign in — with a shared brand nav and footer. `/about` tells the wedge story; `/contact` offers a mailto card with copy-to-clipboard. After entering the OTP code, the user lands on `/dashboard`. The authenticated app looks and behaves exactly as before. `prefers-reduced-motion` shows the hero's final state with no animation.

Verify: load each public page logged-out (nav shows "Sign in") and logged-in (nav shows "Dashboard"); complete a login and confirm it lands on `/dashboard`; confirm the dark-glass app pages are visually unchanged; run lint/typecheck/build/Playwright green.

## What We're NOT Doing

- Not restyling the authenticated app (builder, dashboard, plan table) — public surface only.
- Not building a contact form / email backend — Contact is a mailto card (no new API route, no email provider).
- Not wiring the hero to the live plan-table calc — the ridgeline is a static illustrative SVG with baked sample annotations.
- Not adding feature/FAQ/screenshot marketing sections — lean content only (hero + 3-step + short About).
- Not changing auth, middleware route gating, data, or schema.
- Not changing the PRD or roadmap (additive UX).
- Not making the brand fonts the global app default — fonts are applied on public pages only.

## Implementation Approach

Three phases, foundation-first. Phase 1 lands the reusable pieces (fonts, tokens, public layout, auth-aware nav + footer, ridgeline SVG component) with a placeholder render so the shell is verifiable before any page content. Phase 2 builds the landing page on that shell and flips the post-login redirect. Phase 3 adds the two secondary pages. Each phase is independently buildable.

## Critical Implementation Details

- **Font scoping** — applying a brand font globally would change the authenticated app's typography (currently system default). Apply Space Grotesk / Space Mono via classes or a public-layout-scoped selector so only public pages pick them up; Inter may serve as the public body face without being forced on the app.
- **Hero motion** — the ridgeline draws via SVG path animation (`stroke-dashoffset`) and the sun rises on load; gate both behind `prefers-reduced-motion: no-preference` so reduced-motion users get the final composed frame. This is a CSS-only concern (no JS island needed for the hero).

## Phase 1: Brand foundation & public chrome

### Overview

Establish the reusable brand layer: fonts, design tokens, a public layout, the auth-aware nav + footer, and the ridgeline SVG component — everything the pages compose.

### Changes Required:

#### 1. Brand fonts

**File**: `package.json` (+ import site)

**Intent**: Self-host the three brand faces so public pages can use them without a runtime CDN dependency.

**Contract**: Add `@fontsource` packages for Space Grotesk, Inter, and Space Mono; import the needed weights from the public layout (Phase 1 #3). Weights per `design-direction.md` (display 500/700, body 400/500, mono 400). Do not apply them globally.

#### 2. Design tokens

**File**: `src/styles/global.css`

**Intent**: Register the "Summit at first light" palette and font-family tokens as the single source of truth, usable by Tailwind v4 utilities/arbitrary values on public pages.

**Contract**: Add the six color tokens (`summit-night`, `ridge`, `haze`, `snowcap`, `alpenglow`, `trail-violet`) and three font-family tokens via the Tailwind v4 `@theme` mechanism already used in this file. Hex values exactly as in `design-direction.md`. Additive — must not alter existing app styling.

#### 3. Public layout

**File**: `src/layouts/PublicLayout.astro` (new)

**Intent**: A public-page shell distinct from the app shell — sets the brand background, loads/scopes the brand fonts, and frames pages with the shared nav and footer.

**Contract**: Wraps page content with `PublicNav` (Phase 1 #4) + `<slot>` + `Footer` (Phase 1 #5) on the `summit-night` background. Accepts a `title` prop (per-page `<title>`). May reuse `Layout.astro` as the inner `<html>` shell or stand alone — implementer's call; keep the config `Banner` behavior available. Scope brand fonts here so they don't leak to app pages.

#### 4. Auth-aware public nav

**File**: `src/components/public/PublicNav.astro` (new)

**Intent**: Shared top nav with the wordmark and links, showing Sign in vs Dashboard based on the current user.

**Contract**: Reads `Astro.locals.user` (same pattern as `Topbar.astro`). Links: brand/home (`/`), About (`/about`), Contact (`/contact`), and Sign in (`/auth/signin`) when logged-out / Dashboard (`/dashboard`) + Sign out (POST `/api/auth/signout`) when logged-in. Styled in the brand vocabulary (Space Grotesk wordmark, trail-violet interactive).

#### 5. Footer

**File**: `src/components/public/Footer.astro` (new)

**Intent**: Minimal public footer for secondary links.

**Contract**: Copyright, About/Contact links, and a project/GitHub link; brand styling. Static, no logic.

#### 6. Ridgeline SVG component

**File**: `src/components/public/Ridgeline.astro` (new)

**Intent**: The signature element — a reusable elevation-profile ridgeline used full-size in the hero and as a thin section divider.

**Contract**: Renders an inline SVG path (the static illustrative profile). Props to vary size/role (e.g. `variant="hero" | "divider"`) and to toggle the load-draw animation. Animation via CSS `stroke-dashoffset`, gated behind `prefers-reduced-motion`. Aid-station markers + baked annotations are part of the hero variant.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Playwright suite passes: `npx playwright test`

#### Manual Verification:

- A temporary page using `PublicLayout` renders with the brand background, fonts loaded (Space Grotesk heading, Space Mono sample), nav, and footer
- Nav shows "Sign in" logged-out and "Dashboard" logged-in
- The ridgeline component renders; with reduced-motion on, no animation plays
- Authenticated app pages (dashboard, a plan) are visually unchanged (fonts/tokens didn't leak)

**Implementation Note**: After automated verification passes, pause for manual confirmation before the phase commit.

---

## Phase 2: Landing page + post-login redirect

### Overview

Build the custom landing on the Phase 1 shell and send authenticated users to the dashboard.

### Changes Required:

#### 1. Custom landing page

**File**: `src/pages/index.astro` (+ retire `src/components/Welcome.astro`)

**Intent**: Replace the stock cosmic welcome with the Ultra Planner hero, wedge statement, 3-step how-it-works, and CTA.

**Contract**: `index.astro` uses `PublicLayout` and composes: the `Ridgeline` hero (static illustrative profile with baked aid-station annotations like "+38g · 500ml") with the headline in the "sky" and a single trail-violet CTA to `/auth/signin`; a one-line wedge statement; a genuine 3-step "how it works" (enter race params → add aid stations → get the per-segment plan) using mono distance-style eyebrows. Copy drafted in the interface voice (user reviews). Remove/replace `Welcome.astro` (and its now-unused `Topbar` usage on the landing) since `index.astro` no longer renders it.

#### 2. Post-login redirect → dashboard

**File**: `src/pages/api/auth/verify-code.ts`

**Intent**: Land authenticated users on the app, not the marketing page.

**Contract**: Change the success redirect (`:31`) from `/` to `/dashboard`. Leave `signout.ts` (`→ /`) unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Playwright suite passes: `npx playwright test` (auth specs still green with the new redirect)

#### Manual Verification:

- `/` shows the ridgeline hero, wedge, 3-step how-it-works, and CTA; load animation plays (and is suppressed under reduced-motion)
- Hero is legible and laid out correctly on mobile
- Completing OTP login lands on `/dashboard`
- The CTA routes to sign-in; nav/footer present

**Implementation Note**: After automated verification passes, pause for manual confirmation before the phase commit.

---

## Phase 3: About + Contact pages

### Overview

Add the two secondary public pages on the shared chrome.

### Changes Required:

#### 1. About page

**File**: `src/pages/about.astro` (new)

**Intent**: Tell the wedge story — why per-segment, time-on-feet fueling beats a flat per-km number.

**Contract**: Uses `PublicLayout`; a short manifesto (drafted copy), a recurring ridgeline divider, brand type. No auth, no interactivity.

#### 2. Contact page

**File**: `src/pages/contact.astro` (new)

**Intent**: Let visitors reach the maker without a backend.

**Contract**: Uses `PublicLayout`; a styled contact card with a `mailto:` link and a copy-to-clipboard control for the address. The copy button is the only interactive bit (a tiny React island or inline script — implementer's call, matching project conventions). No API route, no email provider.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Playwright suite passes: `npx playwright test`

#### Manual Verification:

- `/about` and `/contact` load logged-out (no redirect to sign-in) and render on the shared chrome
- Contact mailto opens the mail client; copy-to-clipboard copies the address and gives feedback
- Both pages are responsive and visually consistent with the landing

**Implementation Note**: After automated verification passes, pause for manual confirmation before the phase commit.

---

## Testing Strategy

### Manual Testing Steps:

1. Logged-out: visit `/`, `/about`, `/contact` — all render, nav shows "Sign in", no redirect.
2. Log in via OTP — confirm landing on `/dashboard`.
3. Logged-in: revisit public pages — nav shows "Dashboard" + Sign out.
4. Toggle OS reduced-motion — hero shows final frame, no draw animation.
5. Resize to mobile — hero/ridgeline and nav/footer adapt.
6. Open a plan + the dashboard — confirm the authenticated app is visually unchanged (no font/token leak).

### Integration Tests:

- Existing Playwright suite must stay green; the auth specs exercise the login flow whose redirect now points at `/dashboard` — confirm they still pass (update an assertion only if one hard-codes the post-login path).

## Performance Considerations

Self-hosted fonts add a few static assets — subset/limit weights to those used. Hero is inline SVG + CSS animation (no JS), negligible cost.

## Migration Notes

None — no data or schema. `Welcome.astro` is retired (no longer imported).

## References

- Design direction: `context/changes/public-pages-and-brand/design-direction.md`
- Replace: `src/pages/index.astro`, `src/components/Welcome.astro`
- Auth-aware nav pattern: `src/components/Topbar.astro`
- Redirect: `src/pages/api/auth/verify-code.ts:31`
- Route gating (no change needed): `src/middleware.ts:4`
- Tokens home: `src/styles/global.css`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Brand foundation & public chrome

#### Automated

- [x] 1.1 Type checking passes (`npx astro check`) — 9599a10
- [x] 1.2 Linting passes (`npm run lint`) — 9599a10
- [x] 1.3 Build succeeds (`npm run build`) — 9599a10
- [x] 1.4 Playwright suite passes (`npx playwright test`) — 9599a10

#### Manual

- [x] 1.5 PublicLayout renders with brand background, fonts, nav, footer — 9599a10
- [x] 1.6 Nav shows Sign in (logged-out) / Dashboard (logged-in) — 9599a10
- [x] 1.7 Ridgeline renders; reduced-motion suppresses animation — 9599a10
- [x] 1.8 Authenticated app pages visually unchanged (no font/token leak) — 9599a10

### Phase 2: Landing page + post-login redirect

#### Automated

- [x] 2.1 Type checking passes (`npx astro check`)
- [x] 2.2 Linting passes (`npm run lint`)
- [x] 2.3 Build succeeds (`npm run build`)
- [x] 2.4 Playwright suite passes (`npx playwright test`)

#### Manual

- [x] 2.5 Landing shows hero + wedge + 3-step + CTA; load animation plays (suppressed under reduced-motion)
- [x] 2.6 Hero legible/laid-out on mobile
- [x] 2.7 OTP login lands on /dashboard
- [x] 2.8 CTA routes to sign-in; nav/footer present

### Phase 3: About + Contact pages

#### Automated

- [ ] 3.1 Type checking passes (`npx astro check`)
- [ ] 3.2 Linting passes (`npm run lint`)
- [ ] 3.3 Build succeeds (`npm run build`)
- [ ] 3.4 Playwright suite passes (`npx playwright test`)

#### Manual

- [ ] 3.5 /about and /contact load logged-out (no sign-in redirect) on shared chrome
- [ ] 3.6 Contact mailto opens mail client; copy-to-clipboard works with feedback
- [ ] 3.7 Both pages responsive and consistent with the landing

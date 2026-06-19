# Public pages + mountain-outline brand — Plan Brief

> Full plan: `context/changes/public-pages-and-brand/plan.md`
> Design direction: `context/changes/public-pages-and-brand/design-direction.md`

## What & Why

The public face of the app is still the stock Astro "10x Astro Starter" page, and login dumps users back on it. Replace it with a custom Ultra Planner public site — a ridgeline-hero landing, an About page (the wedge story), and a Contact page — on the "Summit at first light" brand, and send authenticated users to `/dashboard`.

## Starting Point

`index.astro` renders the generic `Welcome.astro`; `Layout.astro` is a plain HTML shell; `Topbar.astro` is already auth-aware. Middleware gates only `/dashboard` + `/plans`, so `/about` and `/contact` are already public. Post-login redirect is `verify-code.ts:31 → "/"`. No font tooling; Tailwind v4 tokens live in `global.css`.

## Desired End State

`/` shows the ridgeline hero (draws on load, sun rising), the per-segment wedge, a 3-step how-it-works, and a violet CTA — with a shared auth-aware nav + footer. `/about` tells the wedge story; `/contact` is a mailto card with copy-to-clipboard. OTP login lands on `/dashboard`. The authenticated app is visually unchanged; reduced-motion shows the hero's final frame.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Visual direction | "Summit at first light" — elevation-profile ridgeline as the signature | The mountain outline *is* the product's data | Design |
| Contact | mailto card + copy-to-clipboard | No email backend wired; zero infra | Plan |
| Hero data | Static illustrative SVG, baked sample annotations | Full control, no runtime cost; marketing visual | Plan |
| Public chrome | Auth-aware nav + minimal footer | Cohesive, navigable; reuses Topbar pattern | Plan |
| Content | Lean (hero + 3-step + short About), I draft copy | Matches the "simple, distinctive" brief | Plan |
| Fonts | Self-host @fontsource, applied public-only | Cloudflare-safe; don't restyle the app | Plan |
| PRD | No change | Additive marketing/UX (tooltips precedent) | Plan |

## Scope

**In scope:** Brand tokens + fonts in `global.css`; `PublicLayout` + auth-aware `PublicNav` + `Footer` + reusable `Ridgeline` SVG; custom landing replacing `Welcome.astro`; About + Contact pages; post-login redirect → `/dashboard`.

**Out of scope:** Restyling the authenticated app; contact form/email backend; live-calc hero; feature/FAQ/screenshot sections; auth/middleware/data/schema/PRD changes; global font default.

## Architecture / Approach

Foundation-first. A public layer (`PublicLayout` + nav + footer + `Ridgeline`) composes the three pages; design tokens land as Tailwind v4 `@theme` entries in `global.css`; brand fonts are scoped to public pages so the app's system-default typography is untouched. The hero is inline SVG + CSS animation (no JS); the only interactive bit is the Contact copy button. `/about` and `/contact` need no middleware change.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Brand foundation & chrome | fonts, tokens, PublicLayout, nav, footer, Ridgeline | Font/token scoping leaking into the app |
| 2. Landing + redirect | custom hero landing; post-login → /dashboard | Auth specs that assume post-login `/`; hero responsiveness |
| 3. About + Contact | manifesto + mailto card | Minimal — static pages on shared chrome |

**Prerequisites:** None (design direction done).
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Brand fonts/tokens must stay scoped to public pages — an app typography regression is the main watch-point (Phase 1 manual check).
- A Playwright auth spec may assert the post-login path; update only if it hard-codes `/`.

## Success Criteria (Summary)

- Custom landing + About + Contact render publicly on the brand; nav is auth-aware.
- OTP login lands on `/dashboard`; the authenticated app looks identical to before.
- Reduced-motion respected; pages responsive to mobile.

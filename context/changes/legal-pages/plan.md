# Legal Pages (Privacy Policy + Terms of Use) Implementation Plan

## Overview

Add two public legal pages — **`/privacy`** (Privacy Policy / GDPR–RODO information) and **`/terms`** (Terms of Use / Regulamin) — written in English, plain-language but complete, accurately describing how Ultra Planner actually processes personal data. Wire both into the footer and public nav, and add a passive acceptance notice on the sign-in page. The content names the real data controller (an individual, with real contact details supplied at implementation), references Polish/EU law, links the existing account-deletion flow as the right to erasure, and discloses cookies in lieu of a cookie banner.

## Current State Analysis

- Public pages are static `.astro` files using `PublicLayout` + a centered content section with the project's design tokens. `src/pages/about.astro:9-37` is the canonical template (prose in `max-w-3xl`, `font-display`/`text-snowcap`/`text-haze`, a `Ridgeline` divider, an optional CTA). `src/pages/contact.astro` is a shorter variant.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/plans"]`. `/privacy` and `/terms` are public by default; **no middleware change is needed**.
- Secondary links live in two places: `src/components/public/Footer.astro:12-13` (About / Contact / GitHub) and `src/components/public/PublicNav.astro:18-19` (About / Contact).
- The **right to erasure is already implemented**: `SettingsMenu` → `/account/delete/confirm` (`src/pages/account/delete/confirm.astro`) → `/api/account/deletion/{request,verify,execute}.ts`. The privacy policy links users there.
- **Personal data actually processed**: email address (auth, via Supabase `signInWithOtp`); plan data the user enters (race params, aid stations, gear); session cookies (Supabase SSR, cookie-based). **Sub-processors**: Supabase (auth + Postgres, with RLS), Resend (account-deletion confirmation email), Cloudflare (Pages/Workers hosting).
- **Contact address is a placeholder**: `src/pages/contact.astro:4` — `const email = "hello@ultra-planner.app"` with `// TODO: replace with the real contact address before launch`. The legal pages reuse this address; it must be made real before publishing (tracked as a launch blocker, not by this change).
- Cookies are **strictly-necessary auth cookies only** (no analytics/marketing), so no consent banner is required — disclosure in the privacy policy suffices.

## Desired End State

Visiting `/privacy` and `/terms` renders two styled, readable legal pages consistent with the rest of the public site. Footer and nav expose both. The sign-in page carries a one-line "by continuing you agree to the Terms & Privacy Policy" notice linking both. The privacy page accurately lists what's collected, why (legal basis), retention, sub-processors, and user rights — with the erasure right linking the live delete flow. The terms page covers acceptable use, termination, liability limits, the "estimates only — not race-day safety/medical advice" disclaimer, and Polish/EU governing law. Each page shows a "Last updated" date. The real data-controller name + contact are written in (supplied at implementation).

Verify: navigate to both routes (200, styled, readable); footer/nav/sign-in links resolve; the erasure section links `/account/delete/confirm`; content matches the actual data flows above.

### Key Discoveries:

- Mirror `src/pages/about.astro:9-37` for page structure; reuse `PublicLayout`, the `max-w-3xl` section, design tokens, and (optionally) the `Ridgeline` divider between major sections.
- No new route gating — `/privacy` and `/terms` fall outside `PROTECTED_ROUTES` (`src/middleware.ts:4`).
- Link the erasure right to the existing flow at `/account/delete/confirm` rather than describing a manual process.
- Sign-in page to annotate: `src/pages/auth/signin.astro`.

## What We're NOT Doing

- No cookie-consent banner (auth-only cookies; disclosed in the privacy policy instead).
- No active consent capture — no signup checkbox, no consent timestamp/version stored, no schema change. Acceptance is passive (footer/nav links + a sign-in notice).
- No Polish translation / no bilingual toggle — English only.
- No version number or changelog — a single "Last updated" date per page.
- No content-collection / MDX system — plain `.astro` prose pages, matching `about.astro`.
- No in-app disclaimer surfaced near the plan output — the safety disclaimer lives in the Terms only (per change notes).
- Not making the `contact.astro` TODO email real — that's a separate launch task; this change reuses whatever the address is.
- This is not legal advice; the content is plain-language and accurate to real flows but is not a substitute for a lawyer's review (noted in the change's risks).

## Implementation Approach

Two static prose pages built from the `about.astro` pattern, then three small wiring edits. Each page is independently reviewable so the privacy content and the terms content can be checked separately. The data-controller's real name + postal/contact details are an implementation-time input (collected when Phase 1 runs); the plan specifies exactly where they go.

## Critical Implementation Details

- **Controller identity is required input, not a design decision.** GDPR/RODO requires an identifiable controller. At implementation, collect the real full name + contact (and postal address if the user wants full compliance) and write them into the privacy page's "Data controller" section. Do not invent values; pause and ask if not supplied.
- **Accuracy over boilerplate.** Only describe data the app actually collects/processes (email, plan data, auth cookies) and the three named sub-processors. Do not copy generic clauses about analytics, advertising, profiling, or international transfers beyond what Supabase/Resend/Cloudflare actually entail.

## Phase 1: Privacy Policy Page

### Overview

Create the `/privacy` page with complete, accurate GDPR/RODO information.

### Changes Required:

#### 1. Privacy Policy page

**File**: `src/pages/privacy.astro` (new)

**Intent**: A public, English, plain-language privacy policy mirroring `about.astro`'s layout. Sections: **Data controller** (real individual name + contact — implementation input); **What we collect** (email for auth; plan data you enter; strictly-necessary session cookies); **Why / legal basis** (contract performance for the service; legitimate interest where applicable); **Sub-processors** (Supabase — auth + Postgres/EU; Resend — deletion emails; Cloudflare — hosting); **Retention** (data kept while the account exists); **Your rights** (access, rectification, erasure, portability, objection) with the **erasure** right linking `/account/delete/confirm`; **Cookies** (auth-only, no tracking — why there's no banner); **Contact** (the shared address); **Last updated** date.

**Contract**: New route `/privacy` rendering via `PublicLayout title="Privacy Policy — Ultra Planner"`. Uses the same section/token structure as `about.astro`. The erasure paragraph contains an `<a href="/account/delete/confirm">`. A "Last updated: <date>" line is present.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`
- Route exists: `dist/` (or dev server) serves `/privacy` with a 200

#### Manual Verification:

- Page renders styled and readable, consistent with `/about`
- Controller section shows the real name + contact (no leftover placeholders)
- Every listed data type / sub-processor matches what the app actually does
- The erasure link navigates to the account-deletion flow

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Terms of Use Page

### Overview

Create the `/terms` page (Regulamin) with the service terms and the safety disclaimer.

### Changes Required:

#### 1. Terms of Use page

**File**: `src/pages/terms.astro` (new)

**Intent**: A public, English, plain-language terms page mirroring `about.astro`. Sections: **Service description** (a pre-race planning aid); **Acceptable use** (don't abuse/attack the service; one account per person); **Accounts** (email-OTP sign-in; you may delete your account anytime → link `/account/delete/confirm`); **Disclaimer** — prominent: *the plan provides time/fuel estimates only and is NOT race-day, medical, nutritional, or safety advice; use at your own risk*; **Liability** (provided "as is"; liability limited to the extent allowed by law); **Termination** (the operator may suspend abusive accounts); **Governing law** (Poland / EU; disputes under Polish jurisdiction); **Contact** (shared address); **Last updated** date.

**Contract**: New route `/terms` rendering via `PublicLayout title="Terms of Use — Ultra Planner"`. Same structure/tokens as `about.astro`. The disclaimer is visually distinct (e.g. a bordered callout like `contact.astro`'s `bg-ridge` card). A "Last updated: <date>" line is present.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`
- Route exists: `/terms` serves a 200

#### Manual Verification:

- Page renders styled and readable, consistent with `/about` and `/privacy`
- The safety disclaimer is present and visually prominent
- Governing-law section reads Poland/EU
- Account-deletion link resolves

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Navigation + Acceptance Wiring

### Overview

Expose both pages site-wide and add the passive acceptance notice.

### Changes Required:

#### 1. Footer links

**File**: `src/components/public/Footer.astro`

**Intent**: Add **Privacy** and **Terms** links alongside About / Contact / GitHub, using the existing link styling.

**Contract**: Two new `<a>` elements (`/privacy`, `/terms`) in the footer `<nav>` (`Footer.astro:11-22`), matching sibling link classes.

#### 2. Public nav links

**File**: `src/components/public/PublicNav.astro`

**Intent**: Add Privacy + Terms to the public nav. Given the nav already holds About/Contact and (when logged in) Dashboard, keep it uncluttered — Privacy/Terms may go in the footer primarily; if added to the nav, match the existing `text-haze hover:text-snowcap` style.

**Contract**: Optional nav `<a>` entries for `/privacy` and `/terms` consistent with `PublicNav.astro:18-19`. (If the nav gets too crowded, footer-only is acceptable — note the decision in the commit.)

#### 3. Sign-in acceptance notice

**File**: `src/pages/auth/signin.astro`

**Intent**: Add a small, unobtrusive line near the sign-in action: "By continuing, you agree to our Terms and Privacy Policy," with both words linked.

**Contract**: A short `<p>` with `<a href="/terms">` and `<a href="/privacy">`, styled as muted helper text consistent with the auth form.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Footer shows Privacy + Terms on public and app pages; links resolve
- Sign-in page shows the acceptance line with both links working
- No layout regression in the footer/nav/sign-in on mobile + desktop widths

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- None — static prose pages with no logic. (No vitest coverage warranted.)

### Integration Tests:

- Optional lightweight Playwright spec (`tests/legal-pages.spec.ts`): unauthenticated GET `/privacy` and `/terms` return 200 and contain their headings; footer exposes both links; sign-in page shows the acceptance line. Not gated behind `TEST_EMAIL` (no auth needed) — these are public routes. Decide during implementation whether to add it; it's cheap and guards the routes against future regressions.

### Manual Testing Steps:

1. Visit `/privacy` and `/terms` logged-out and logged-in — both render, styled, readable.
2. Confirm every data claim on `/privacy` matches reality (email, plan data, auth cookies, the three sub-processors) and the controller details are real.
3. Confirm the `/terms` safety disclaimer is prominent and governing law reads Poland/EU.
4. Click Privacy/Terms from the footer, nav (if added), and the sign-in notice — all resolve.
5. Click the erasure link → lands on `/account/delete/confirm`.

## Performance Considerations

None — static server-rendered prose, no client JS beyond the existing layout.

## Migration Notes

None — no schema, no data, no stored consent.

## References

- Page template: `src/pages/about.astro:9-37`; card pattern: `src/pages/contact.astro:17-35`
- Link locations: `src/components/public/Footer.astro:11-22`, `src/components/public/PublicNav.astro:17-37`
- Public routing (no gating needed): `src/middleware.ts:4`
- Erasure flow to link: `src/pages/account/delete/confirm.astro`, `src/pages/api/account/deletion/*`
- Sign-in page: `src/pages/auth/signin.astro`
- Contact address (shared, placeholder TODO): `src/pages/contact.astro:4`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Privacy Policy Page

#### Automated

- [x] 1.1 Build passes (`npm run build`)
- [x] 1.2 Linting passes (`npm run lint`)
- [x] 1.3 `/privacy` route serves a 200

#### Manual

- [x] 1.4 Page renders styled/readable, consistent with `/about`
- [x] 1.5 Controller section shows real name + contact (no placeholders)
- [x] 1.6 Data types / sub-processors match actual app behavior
- [x] 1.7 Erasure link navigates to the account-deletion flow

### Phase 2: Terms of Use Page

#### Automated

- [ ] 2.1 Build passes (`npm run build`)
- [ ] 2.2 Linting passes (`npm run lint`)
- [ ] 2.3 `/terms` route serves a 200

#### Manual

- [ ] 2.4 Page renders styled/readable, consistent with `/about` and `/privacy`
- [ ] 2.5 Safety disclaimer present and visually prominent
- [ ] 2.6 Governing-law section reads Poland/EU; deletion link resolves

### Phase 3: Navigation + Acceptance Wiring

#### Automated

- [ ] 3.1 Build passes (`npm run build`)
- [ ] 3.2 Linting passes (`npm run lint`)

#### Manual

- [ ] 3.3 Footer (and nav if added) show Privacy + Terms; links resolve
- [ ] 3.4 Sign-in page shows the acceptance line with both links working
- [ ] 3.5 No footer/nav/sign-in layout regression on mobile + desktop

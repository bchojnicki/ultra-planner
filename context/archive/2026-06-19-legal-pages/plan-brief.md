# Legal Pages (Privacy + Terms) — Plan Brief

> Full plan: `context/changes/legal-pages/plan.md`

## What & Why

Add two public legal pages — `/privacy` (GDPR/RODO) and `/terms` (Regulamin) — so Ultra Planner meets its baseline data-protection obligations: it stores user emails and personal plan data for EU users, which legally requires a privacy policy and (for a Polish-operated service) terms. Both are written in English, plain-language but complete, and accurately reflect how the app actually processes data.

## Starting Point

The public site already has `/about` and `/contact` (static `.astro` pages on `PublicLayout`), a footer + nav with secondary links, and a working account-deletion flow (`/account/delete/confirm`). There are no legal pages today, and the `/contact` email is a `// TODO: replace before launch` placeholder.

## Desired End State

`/privacy` and `/terms` render as styled, readable pages consistent with `/about`. The footer (and optionally nav) link both; the sign-in page shows a passive "by continuing you agree to Terms & Privacy" notice. Privacy accurately lists what's collected (email, plan data, auth cookies), why, retention, the three sub-processors, and user rights — with erasure linking the live delete flow. Terms cover acceptable use, liability, termination, Poland/EU governing law, and a prominent "estimates only — not safety advice" disclaimer. Each page shows a "Last updated" date.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Language | English only | Matches the UI; one language to maintain | Plan |
| Data controller | Individual, real details now | RODO needs an identifiable controller; supplied at implementation | Plan |
| Governing law | Poland / EU | Honest about where the service operates | Plan |
| Privacy/data contact | Reuse `/contact` address | One address to maintain (inherits the pre-launch TODO) | Plan |
| Acceptance | Passive (footer/nav links + sign-in notice) | Zero signup friction, no consent storage; standard for MVP | Plan |
| Content depth | Plain-language but complete | Accurate to real flows, readable; avoids overpromising boilerplate | Plan |
| Versioning | "Last updated" date only | Standard and cheap; no changelog overhead yet | Plan |
| Cookie banner | Out of scope | Auth-only cookies need no consent; disclosed in privacy policy | Notes |

## Scope

**In scope:** `/privacy` + `/terms` pages; footer + nav links; sign-in acceptance notice; effective-date lines; erasure link to the existing delete flow; optional public-route Playwright check.

**Out of scope:** cookie banner; active consent capture / schema; Polish translation; version/changelog; in-app disclaimer near plan output; making the contact email real; legal review (flagged as a follow-up).

## Architecture / Approach

Two static prose pages built from the `about.astro` pattern (`PublicLayout` + `max-w-3xl` section + design tokens), then three small wiring edits (footer, nav, sign-in). No logic, no schema, no middleware change (`/privacy` + `/terms` fall outside `PROTECTED_ROUTES`). The controller's real name + contact are an implementation-time input.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Privacy Policy page | `/privacy` with accurate GDPR/RODO content | Content claiming data the app doesn't collect (mitigated by mapping to real flows) |
| 2. Terms of Use page | `/terms` with the safety disclaimer + PL/EU law | Disclaimer not prominent enough |
| 3. Nav + acceptance wiring | Footer/nav links + sign-in notice | Nav clutter (fallback: footer-only) |

**Prerequisites:** Real data-controller name + contact details (collected at implementation).
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- **Not legal advice** — content is plain-language and accurate to real flows but should get a lawyer's review before launch, especially the controller identity and PL-specific Regulamin requirements.
- The shared contact email is still a pre-launch placeholder; the legal pages inherit it and it must be made real before publishing.
- Assumes cookies stay auth-only — adding analytics later would require revisiting the cookie disclosure (and likely a consent banner).

## Success Criteria (Summary)

- `/privacy` and `/terms` render correctly, are linked from the footer + sign-in, and read accurately for a layperson.
- The privacy page's data claims match the app's real processing; the erasure right links the working delete flow.
- The terms page carries a prominent safety disclaimer and Poland/EU governing law.

<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Legal Pages (Privacy + Terms)

- **Plan**: context/changes/legal-pages/plan.md
- **Scope**: All 3 phases (complete)
- **Date**: 2026-06-19
- **Verdict**: APPROVED (3 observations; F1 & F2 fixed, F3 accepted)
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Changed files matched the plan exactly; no unplanned files. PublicNav left
untouched (the plan explicitly allowed footer-only). Build clean, lint clean
(repo-wide exit 0), all routes 200, every manual check confirmed.

## Findings

### F1 — Privacy describes "a session cookie" (singular)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence (accuracy)
- **Location**: src/pages/privacy.astro (What we collect / Cookies)
- **Detail**: Supabase SSR sets its auth token under `sb-<ref>-auth-token` and may chunk it across more than one cookie, so the singular understated the count for a privacy policy.
- **Fix**: Pluralized to "Session cookies" / "the session cookies" / "the cookies we set" / "clear them."
- **Decision**: FIXED

### F2 — No route-regression test added

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/ (no legal-pages.spec.ts)
- **Detail**: The plan's optional public-route spec hadn't been added, leaving `/privacy` and `/terms` with no guard against a future 404 or removed footer/sign-in link.
- **Fix**: Added `tests/legal-pages.spec.ts` (4 tests, not TEST_EMAIL-gated): both routes render, the erasure link resolves, the terms disclaimer shows, the footer links both pages, and the sign-in acceptance notice appears. All 4 pass.
- **Decision**: FIXED

### F3 — Legal pages publish the placeholder contact email

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence (launch readiness)
- **Location**: src/pages/privacy.astro, src/pages/terms.astro, src/pages/contact.astro:4
- **Detail**: Both pages use `hello@ultra-planner.app`, still flagged as a `// TODO: replace before launch` in contact.astro. A privacy policy gives this address legal weight (the GDPR data-subject-request channel), so it must resolve to a real, monitored inbox before publishing.
- **Fix**: Make the shared contact address real before publishing — tracked outside this change.
- **Decision**: SKIPPED (accepted as a known launch blocker)

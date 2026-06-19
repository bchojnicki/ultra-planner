---
change_id: public-pages-and-brand
title: Custom welcome + about/contact pages with mountain-outline branding
created: 2026-06-19
updated: 2026-06-19
status: implemented
archived_at: null
---

## Notes

Bundles three related public-surface items (reported 2026-06-19):

1. **Custom welcome page** — `src/pages/index.astro` currently renders the stock Astro `Welcome.astro`. Replace with a real landing page. Also: after login, `src/pages/api/auth/verify-code.ts:31` redirects to `/` (the default page) — change the post-login destination to `/dashboard`.
2. **About + Contact pages** — public, accessible without logging in. Must NOT be added to the middleware `PROTECTED_ROUTES` (which gates `/dashboard` + `/plans`).
3. **Simple graphic design** — mountain-outline visual direction. **Scope: public/marketing pages only** (welcome, about, contact); the authenticated app/builder is left as-is for now.

Cohesive because all three share one design language and the public surface. Recommend `/10x-shape` first (open design direction) before `/10x-plan`. Second of 4 post-MVP backlog changes.

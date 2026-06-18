# Review Follow-ups — gpx-import

Queued fixes/requirements surfaced during implementation reviews.

## From Phase 3 review (2026-06-18)

### F1 → Phase 5: surface a clear "import failed — please retry" error

- **Source**: impl-review-phase-3 F1 (Safety & Quality, observation).
- **Why**: The import endpoint's replace-all is non-transactional (update plan →
  delete stations → bulk insert). If the bulk insert fails after the delete
  succeeds, the plan keeps its new totals but ends up with zero stations. This is
  the plan's accepted idempotent-re-import tradeoff — the mitigation is making the
  failure visible so the user knows to re-import.
- **Action in Phase 5**: the upload UI (`GpxImport` / `RaceSetupForm`) must catch a
  non-2xx response from `POST /api/plans/:id/gpx-import` and show an explicit error
  prompting re-import, rather than failing silently or leaving the form in a
  half-applied state.
- **Location**: `src/pages/api/plans/[id]/gpx-import.ts:39-44` (the non-transactional
  sequence); fix lands in the Phase 5 UI, not the endpoint.
- **Status**: DONE in Phase 5 — `GpxImport.tsx` shows "Import failed — your plan may
  be partly updated. Please try importing again." on a non-2xx/network failure.

## From Phase 5 (2026-06-18)

### 5.1 GPX e2e — RESOLVED

- **Source**: Phase 5 automated check 5.1 (`tests/gpx-import.spec.ts`).
- **Original (incorrect) diagnosis**: thought the signin island wasn't hydrating
  under Playwright. It hydrates fine.
- **Actual causes**: (1) cold-start — the first navigation against a freshly
  started `astro dev` server triggers on-demand route/island compilation that
  exceeded the 30s per-test timeout (`getByLabel("Email")` timed out). Against a
  warm dev server it signs in in ~2s. (2) An ESM bug in the spec: `__dirname` is
  undefined under Playwright's ESM loader; switched the fixture path to
  `fileURLToPath(new URL("./fixtures/sample.gpx", import.meta.url))`.
- **Status**: RESOLVED — passes 3/3 browsers (chromium, firefox, webkit) with
  `TEST_EMAIL` set and a running local Supabase/Mailpit. Gated/skipped in CI.
- **Caveat**: from a fully cold dev server the first run can still be slow to
  compile; run against a warm `npm run dev`, or re-run, if the first attempt is
  sluggish.


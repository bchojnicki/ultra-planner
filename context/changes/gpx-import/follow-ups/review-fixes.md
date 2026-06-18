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

### 5.1 GPX e2e blocked by pre-existing auth-hydration failure

- **Source**: Phase 5 automated check 5.1 (`tests/gpx-import.spec.ts`).
- **Why**: The shared OTP sign-in helper (`signInViaOtp` → `getByLabel("Email")`)
  times out before any GPX step runs. The PRE-EXISTING `tests/auth.spec.ts:18`
  ("renders the email-only form") fails at the identical locator — the signin form
  is a client-only island that emits no SSR markup and does not hydrate under
  Playwright in this local environment. Not caused by gpx-import.
- **Impact**: The GPX e2e cannot get a green local run. In CI the spec is gated
  behind `TEST_EMAIL` and skips, so it does not fail the pipeline. The GPX
  parse/compute/import path is otherwise covered by unit + integration tests and
  two real-file validations (DFBG track-only, COURSE 5-waypoint).
- **Action**: Investigate why the auth signin island fails to hydrate under
  Playwright (separate from gpx-import), then re-enable 5.1. Track as its own task.


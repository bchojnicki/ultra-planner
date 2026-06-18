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

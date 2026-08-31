# Input-pipeline integrity (GPX + segment recompute) — Plan Brief

> Full plan: `context/changes/testing-input-pipeline-integrity/plan.md`
> Research: `context/changes/testing-input-pipeline-integrity/research.md`

## What & Why

Rollout Phase 2 of the test plan, closing **Risk #2** (GPX extraction wrong at source, silently
infecting every segment time/nutrition number) and **Risk #5** (stale per-segment gear
selections after a station change). Research found both narrower than §2 implied: the GPX math
already has an independent oracle and segment re-derivation is Phase-1-locked. This phase adds
the two genuinely missing cheap-layer tests — an end-to-end GPX fixture and the count-based
reconciliation rule — every expectation hand-derived, no production change.

## Starting Point

`src/lib/gpx.ts` is the sole correctness gate for GPX (the server trusts client numbers; raw
`gpx_*` is the calibration denominator). Its three pure functions are unit-tested in isolation
but never run together on a whole `.gpx` file, and haversine is only checked in the small-angle
limit. For Risk #5, `staleSegmentIndexes` (gear-allocation.ts:216-227) is pure, client-only, and
**count-based** — a reorder or interior-merge silently mis-attributes a selection to the wrong
leg, and the server helper `deleteSelectionsForSegments` is dead code. Both are untested.

## Desired End State

`npx vitest run tests/unit` passes with a new end-to-end GPX-fixture group (G1 + a true-geodetic
haversine check G2) and a reconciliation-rule group (S1–S3) that locks the count-based contract
**and asserts its reorder/interior-merge limitation as current behavior**. §6.4 cookbook
documents the GPX-fixture pattern; the mis-attribution fix and dead helper are recorded as
deferred follow-ups. No new deps, no production-code change.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Mis-attribution bug (count-based rule) | Lock current contract, test-only | Keeps this a pure test rollout; mirrors Phase 1's deferral | Research + Plan |
| GPX fixture provenance | Synthetic, hand-computed | Deterministic, licence-free, transparent oracle (real-course totals don't match raw delta-sum) | Plan |
| Optional scope | Include G2 geodetic check + record deferred follow-ups | G2 pins haversine beyond the shared-constant limit; follow-ups capture real findings | Plan |
| Dead `deleteSelectionsForSegments` | Record only | Test-only phase; removal/wiring is a separate decision | Research + Plan |
| Phasing | Two phases (GPX / reconciliation) + cookbook step | Two distinct seams/files, each independently verifiable | Plan |
| Layer | Unit only | Persistence already covered by integration; orchestration is e2e (deferred) | Research |

## Scope

**In scope:** synthetic `.gpx` fixture; end-to-end GPX tests (G1 + G2) in `gpx.test.ts`;
reconciliation-rule tests (S1–S3) in `gear-allocation.test.ts`; §6.4 cookbook; recording 2
deferred items.

**Out of scope:** fixing the mis-attribution bug; removing/wiring the dead helper; segment
re-derivation (Phase 1 owns it); integration round-trips (already covered); e2e; new deps;
editing §2 wording (orchestrator's backport job).

## Architecture / Approach

Extend two existing unit-test files using their established independent-oracle patterns: a static
hand-computed `.gpx` fixture drives the full `parseGpx`→math chain (jsdom env), and the pure
`staleSegmentIndexes` / `computeAllocations` rules are asserted against their documented
count-based contract. Each phase ends by updating the §6.4 cookbook / recording deferred items.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. GPX golden test (G1/G2) | Fixture + end-to-end parse→compute oracle + geodetic anchor | Oracle slip — totals not truly hand-derived from coordinates |
| 2. Reconciliation tests (S1–S3) + deferred items | Count-based contract locked w/ limitation asserted; cookbook + follow-ups | Accidentally asserting the buggy behavior as *correct* instead of *current* |

**Prerequisites:** local Vitest (jsdom available, already used by `gpx.test.ts`); no Supabase/DB
needed for this phase.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The count-based reconciliation's reorder/interior-merge mis-attribution is a real latent bug,
  locked as *current* behavior here; the identity-anchored fix is deferred to a separate change.
- The synthetic fixture's totals must be re-derivable on paper — if a coordinate is chosen poorly
  the "oracle" becomes opaque; keep legs simple.

## Success Criteria (Summary)

- `npx vitest run tests/unit` green with the new GPX-fixture and reconciliation-rule cases.
- The GPX parse→compute chain is proven end-to-end against an independent fixture oracle.
- The count-based reconciliation contract is locked with its limitation documented; §6.4 filled;
  mis-attribution fix + dead helper recorded for follow-up.

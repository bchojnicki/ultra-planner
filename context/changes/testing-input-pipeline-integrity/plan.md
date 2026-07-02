# Input-pipeline integrity (GPX + segment recompute) Implementation Plan

## Overview

Close the cheap-layer test gaps for **Risk #2** (GPX extraction wrong at source) and **Risk #5**
(segment recompute / stale gear-selection clearing) of `context/foundation/test-plan.md`
(rollout Phase 2). Research proved both halves are narrower than §2 implied: the GPX math
already has an independent oracle and the segment **re-derivation** is already locked by Phase 1
(U1/U2/U3). The genuine, fundable gaps are two pure-unit surfaces — a real `.gpx` fixture run
**end-to-end** through the parse→compute chain, and the **count-based gear-selection
reconciliation rule** (`staleSegmentIndexes`). Every expected value is hand-derived from an
independent oracle, with **no new dependencies and no production-code change**.

## Current State Analysis

- **`src/lib/gpx.ts` is the sole correctness gate for Risk #2.** The import route
  (`gpx-import.ts:33-41`) trusts the client-computed numbers — `gpxImportSchema.safeParse`
  validates only shape + non-negativity, then writes verbatim. Raw `gpx_*` is the
  **calibration denominator** in `computePlanTable` (`metricCalibration`, plan-table.ts:33-36),
  so a wrong extraction silently skews every segment weight → time → nutrition number while
  still reconciling to the user-trusted total.
- **The GPX math is pure and already independently tested — but never end-to-end.**
  `distance3dKm`, `elevationGainLoss` (raw delta-sum, no smoothing), and
  `projectWaypointsToStations` each have hand-derived unit tests in `tests/unit/gpx.test.ts`,
  but no test runs a **whole `.gpx` file** through `parseGpx` then the three functions against
  an external total, and the haversine is only checked in the small-angle limit (it shares the
  `6_371_000` radius constant with the source).
- **Risk #5's re-derivation half is already covered.** "Merge on delete," "re-sort on edit,"
  "re-derive per-segment distance/elevation" are the pure `computePlanTable` — Phase 1's U1
  (out-of-order sort), U2 (duplicate → zero-length leg skipped = merge), U3 (beyond-total drop)
  lock it. Re-testing would duplicate coverage.
- **The net-new Risk #5 gap is the stale gear-selection reconciliation — pure, client-only,
  count-based.** `PlanEditor.onStationsChange` (PlanEditor.tsx:120-136) calls the pure
  `staleSegmentIndexes` (gear-allocation.ts:216-227), which returns `[]` whenever
  `prevCount === nextCount` and otherwise clears only indices `>= nextSegmentCount`. There is
  **no server/DB reconciliation**; `deleteSelectionsForSegments` (gear-selections.ts:63-75) is
  **dead code** (zero production call sites).

### Key Discoveries

- GPX math: `src/lib/gpx.ts:52-72` (distance/gain-loss), `:95-111` (waypoint projection),
  `:134-147` (`parseGpx`, DOM — needs `// @vitest-environment jsdom`).
- Independent-oracle test seam to extend: `tests/unit/gpx.test.ts:17,25-138`.
- Reconciliation rule: `src/lib/gear-allocation.ts:216-227` (`staleSegmentIndexes`, count-based)
  and `:200-208` (positional `computeAllocations` filter, `segment_index === idx`).
- Reconciliation test seam to extend: `tests/unit/gear-allocation.test.ts` (exists).
- Latent bug (do NOT lock as correct; assert as a known limitation): reorder-without-count-change
  and interior-merge silently mis-attribute a selection — `segment_index` is an ordinal with no
  station/distance anchor.
- Persistence already covered: `tests/integration/gpx-import-flow.test.ts:143-191`.

## Desired End State

`npx vitest run tests/unit` passes with a new end-to-end GPX-fixture test group (G1 + the G2
geodetic check) and a new reconciliation-rule group (S1–S3), each asserting an independently
derived expected value. The "three GPX functions are only tested in isolation" gap and the
"`staleSegmentIndexes` derivation is untested" gap are closed; the count-based contract is
locked **with its reorder/interior-merge limitation asserted as current behavior**, not hidden.
`test-plan.md` §6.4 is filled with the canonical GPX-fixture pattern, and the two deferred items
(identity-anchored selection fix, dead `deleteSelectionsForSegments`) are recorded.

Verify: `npx vitest run tests/unit` is green; `npm run lint` passes; §6.4 no longer reads "TBD";
the deferred items appear in this change folder.

## What We're NOT Doing

- **Not fixing the mis-attribution bug.** We lock the current count-based contract and assert
  its reorder/interior-merge limitation as current behavior. The identity/distance-anchored fix
  is a separate change — recorded as a deferred follow-up, not implemented here.
- **Not removing or wiring `deleteSelectionsForSegments`.** Its dead-code status is recorded as
  a deferred decision; this is a test-only phase.
- **Not re-testing segment re-derivation.** Phase 1's U1/U2/U3 own merge/re-sort/re-derive.
- **No integration or e2e additions.** Persistence round-trips are already covered by
  `gpx-import-flow.test.ts`; the file→DB and UI-edit→selection-clear orchestrations are e2e
  (deferred, per the import flow's own Phase-5 note and Phase 1's no-e2e stance).
- **No new dependencies, no production-code change.** Both files use existing patterns; the
  fixture is a static `.gpx` asset.
- **Not editing §2 risk wording.** Research's 5 backport corrections are the `/10x-test-plan`
  orchestrator's job (flagged in research.md); this plan only consumes the corrected scope.

## Implementation Approach

Two phases mapped to the two distinct seams/files, each independently runnable and verifiable.
Phase 1 adds the GPX fixture + extends `gpx.test.ts`; Phase 2 extends `gear-allocation.test.ts`
and records the deferred items. Expected values are hand-computed from the coordinates / the
documented positional contract — never read back from `gpx.ts` or `staleSegmentIndexes` output.

## Critical Implementation Details

- **Oracle discipline (the whole point).** GPX expectations must be derivable on paper from the
  fixture coordinates (haversine + 3D leg + delta-sum) and written as comments next to the
  assertions, as the existing file does. Reconciliation expectations come from the documented
  count-based contract, not from running the function.
- **The fixture is synthetic and hand-computed.** Author a tiny `.gpx` (4–6 `<trkpt>` + 2
  `<wpt>`) with coordinates chosen so distance/gain/loss are exactly hand-computable; the
  fixture's totals are the oracle. Place a waypoint exactly on a known track point so its
  projected cumulative values are unambiguous.
- **S1–S3 lock current behavior, including the limitation.** The reorder/interior-merge
  mis-attribution is asserted as *current* behavior (e.g. "equal count → no pruning, so a stale
  index survives") — a future fix must consciously update these tests. Do NOT write an assertion
  that claims selections always follow the correct leg; that would fail against current code.
- **`parseGpx` needs jsdom.** `tests/unit/gpx.test.ts` already declares
  `// @vitest-environment jsdom`; the fixture test runs there.

## Phase 1: GPX extraction golden test (G1 + G2)

### Overview

Add a synthetic `.gpx` fixture and extend `tests/unit/gpx.test.ts` to prove the full
parse→compute chain against a hand-computed oracle, plus a true-geodetic haversine check. Then
fill the §6.4 cookbook entry.

### Changes Required:

#### 1. Synthetic GPX fixture

**File**: `tests/fixtures/<race-name>.gpx` (new)

**Intent**: A tiny, hand-computable GPX track + waypoints that serves as the independent oracle
for the end-to-end extraction test. Coordinates chosen so each leg's 2D distance, 3D distance,
and elevation deltas are exactly computable by hand.

**Contract**: Valid GPX XML with 4–6 `<trkpt lat lon><ele></ele></trkpt>` points (across at
least one `<trkseg>`) and 2 `<wpt>` waypoints (one placed exactly on a known track point), each
`<wpt>` carrying a `<name>`. The file's hand-computed total distance / gain / loss / per-waypoint
cumulative values are documented in a comment block in the test, not in the fixture.

#### 2. End-to-end GPX extraction cases (G1 + G2)

**File**: `tests/unit/gpx.test.ts`

**Intent**: Add a describe block that loads the fixture, runs `parseGpx` then the three pure
functions, and asserts against the hand-computed oracle — closing the "functions only tested in
isolation, never on a whole file" gap. Add the geodetic check (G2).

**Contract**: Reads the fixture (via `fs`/`readFileSync` of the `tests/fixtures/*.gpx` path),
then:
- **G1a** `parseGpx(fixture)` yields the expected track length and waypoint names/coords.
- **G1b** `distance3dKm(track)` and `elevationGainLoss(track)` reconcile to the hand-computed
  total distance / gain / loss (within rounding).
- **G1c** `projectWaypointsToStations(track, waypoints)` returns stations sorted by cumulative
  distance; the waypoint placed on a known track point yields that point's cumulative
  distance/gain/loss exactly, with its `name` in `notes`.
- **G2** A single leg whose endpoints are 1° of latitude apart asserts `distance3dKm`
  (or the underlying 2D leg) ≈ 111.19 km within tolerance — a real-world geodetic anchor beyond
  the small-angle limit the existing tests share with the source constant.

### Success Criteria:

#### Automated Verification:

- New GPX tests pass: `npx vitest run tests/unit/gpx.test.ts`
- Full unit suite passes: `npx vitest run tests/unit`
- Lint passes: `npm run lint`
- Type-check passes

#### Manual Verification:

- The fixture's totals are hand-derived in a test comment; no expected value is read back from `gpx.ts`
- G1c's on-point waypoint assertion uses the exact cumulative values, not approximations
- §6.4 cookbook entry updated with the GPX-fixture independent-oracle pattern

**Implementation Note**: After Phase 1's automated verification passes, pause for human
confirmation that the fixture oracle is genuinely independent before starting Phase 2.

#### 3. Cookbook update (§6.4)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.4 "TBD" placeholder with the concrete GPX-fixture pattern.

**Contract**: §6.4 names the fixture location (`tests/fixtures/*.gpx`), the jsdom requirement for
`parseGpx`, the independent-oracle rule (hand-compute totals from coordinates, comment the
derivation), the reference test (the new block in `tests/unit/gpx.test.ts`), and the run command.

---

## Phase 2: Reconciliation-rule tests (S1–S3) + deferred items

### Overview

Extend `tests/unit/gear-allocation.test.ts` to lock the count-based `staleSegmentIndexes`
contract and the positional allocation filter, asserting the known limitation as current
behavior, then record the two deferred items.

### Changes Required:

#### 1. Reconciliation-rule cases

**File**: `tests/unit/gear-allocation.test.ts`

**Intent**: Add cases that pin the pure reconciliation rule's documented count-based contract and
the positional mapping that makes mis-attribution possible — the net-new Risk #5 surface.

**Contract**: Calls `staleSegmentIndexes(prevCount, nextCount, selections)` and
`computeAllocations(...)` and asserts against the documented positional contract:
- **S1** `prevCount === nextCount` → returns `[]` (no pruning). A companion assertion documents
  that a reorder-without-count-change therefore leaves a stale selection in place — **asserted as
  current behavior / known limitation**, with a comment pointing at the deferred fix.
- **S2** `nextCount < prevCount` → exactly the indices `>= nextCount` are returned, sorted and
  de-duplicated; `nextCount > prevCount` (growth) → returns `[]`.
- **S3** `computeAllocations` maps each row by positional index, filtering selections to
  `segment_index === idx`, so a selection whose index is out of range contributes to no row
  (the positional mapping behind the mis-attribution).

#### 2. Record deferred items

**File**: `context/changes/testing-input-pipeline-integrity/change.md` (Notes)

**Intent**: Persist the two findings so they are not lost, without acting on them.

**Contract**: Record (a) **selection mis-attribution fix** — `staleSegmentIndexes` is count-based;
reorder/interior-merge silently mis-attribute a selection; a future change may re-anchor
selections on station identity/cumulative distance (locked as current behavior by S1/S2 for now);
(b) **dead `deleteSelectionsForSegments`** — defined in `gear-selections.ts:63-75` with no
production call site; a future change may remove it or wire it as a server-side safety net for
the raw-API path.

### Success Criteria:

#### Automated Verification:

- New reconciliation tests pass: `npx vitest run tests/unit/gear-allocation.test.ts`
- Full unit suite passes: `npx vitest run tests/unit`
- Lint passes: `npm run lint`

#### Manual Verification:

- S1 asserts the reorder/interior-merge limitation as *current* behavior (not as correct), with a comment referencing the deferred fix
- No assertion claims selections always follow the correct leg
- Two deferred items recorded in `change.md`
- No new dependency added to `package.json`

**Implementation Note**: After Phase 2's automated verification passes, confirm the §3 Phase-2
row in `test-plan.md` can be marked `complete` and the deferred items are captured.

---

## Testing Strategy

### Unit Tests:

- GPX end-to-end fixture (G1) + geodetic anchor (G2) in `tests/unit/gpx.test.ts`.
- Reconciliation contract (S1–S3) in `tests/unit/gear-allocation.test.ts`.
- All expectations hand-derived; S1–S3 lock current behavior including the known limitation.

### Integration Tests:

- None. Persistence is already covered by `tests/integration/gpx-import-flow.test.ts`; the
  reconciliation is a client-side pure rule with no server/DB step to integration-test.

### Manual Testing Steps:

1. Run `npx vitest run tests/unit` — confirm the new GPX and reconciliation cases pass.
2. Re-derive one fixture total (e.g. gain) on paper from the coordinates and match the comment.
3. Confirm `git diff package.json` is empty (no new deps) and no `src/` file changed.

## Performance Considerations

None — pure unit tests, negligible runtime.

## Migration Notes

None — no schema or data change.

## References

- Research: `context/changes/testing-input-pipeline-integrity/research.md` (test targets
  G1/G2/S1–S3, oracle audit, the latent mis-attribution finding, deferred decisions, and the 5
  §2 backport corrections for `/10x-test-plan` — not done here).
- Test plan: `context/foundation/test-plan.md` (§2 Risks #2/#5, §3 Phase 2, §6.4 cookbook).
- GPX under test: `src/lib/gpx.ts:52-147`; reconciliation: `src/lib/gear-allocation.ts:200-227`.
- Test seams to extend: `tests/unit/gpx.test.ts`, `tests/unit/gear-allocation.test.ts`.
- Phase 1 precedent: `context/changes/testing-plan-generation-correctness/plan.md`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: GPX extraction golden test (G1 + G2)

#### Automated

- [x] 1.1 New GPX tests pass: `npx vitest run tests/unit/gpx.test.ts` — a750421
- [x] 1.2 Full unit suite passes: `npx vitest run tests/unit` — a750421
- [x] 1.3 Lint passes: `npm run lint` — a750421
- [x] 1.4 Type-check passes — a750421

#### Manual

- [x] 1.5 Fixture totals hand-derived in a test comment; no expected value read back from gpx.ts — a750421
- [x] 1.6 G1c on-point waypoint assertion uses exact cumulative values — a750421
- [x] 1.7 §6.4 cookbook GPX-fixture entry updated — a750421

### Phase 2: Reconciliation-rule tests (S1–S3) + deferred items

#### Automated

- [x] 2.1 New reconciliation tests pass: `npx vitest run tests/unit/gear-allocation.test.ts`
- [x] 2.2 Full unit suite passes: `npx vitest run tests/unit`
- [x] 2.3 Lint passes: `npm run lint`

#### Manual

- [x] 2.4 S1 asserts the reorder/interior-merge limitation as current behavior, with a deferred-fix comment
- [x] 2.5 No assertion claims selections always follow the correct leg
- [x] 2.6 Two deferred items recorded in `change.md`
- [x] 2.7 No new dependency added to `package.json`

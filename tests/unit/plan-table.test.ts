// Golden-number tests for the plan-table calculation (S-02, Phase 1).
// Expectations are hand-derived from the PRD Business Logic, independent of the
// implementation, so a regression in the wedge fails loudly. Pure — no DB.
import { describe, expect, it } from "vitest";
import type { AidStation, Plan } from "../../src/types";
import { computePlanTable } from "../../src/lib/plan-table";

const START = "2026-09-01T06:00:00.000Z";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    user_id: "user-1",
    name: "Test race",
    total_distance_km: 100,
    total_elevation_gain_m: 2000,
    total_elevation_loss_m: 2000,
    gpx_distance_km: null,
    gpx_elevation_gain_m: null,
    gpx_elevation_loss_m: null,
    start_time: START,
    total_expected_minutes: 600,
    hourly_fluid_ml: 500,
    hourly_carb_g: 60,
    hourly_sodium_mg: 700,
    created_at: START,
    updated_at: START,
    ...overrides,
  };
}

function makeStation(overrides: Partial<AidStation> = {}): AidStation {
  return {
    id: `as-${Math.random().toString(36).slice(2, 8)}`,
    plan_id: "plan-1",
    cumulative_distance_km: 40,
    cumulative_elevation_gain_m: 1000,
    cumulative_elevation_loss_m: 0,
    time_spent_min: 0,
    water_only: false,
    food_available: false,
    warm_meal: false,
    drop_bag_available: false,
    rest_area: false,
    support_crew_allowed: false,
    notes: null,
    created_at: START,
    updated_at: START,
    ...overrides,
  };
}

describe("computePlanTable — worked reference", () => {
  // 100 km / 2000 m / 600 min, hourly 500/60/700, start 06:00; one station at
  // 40 km / 1000 m / rest 10 min. Weights 50 & 70 (Σ120), moving = 590.
  const result = computePlanTable(makePlan(), [makeStation({ time_spent_min: 10 })]);

  it("produces two segments", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
  });

  it("segment 1 (Start → AS1): distance/weight/moving/nutrition/arrival", () => {
    if (!result.ok) throw new Error("expected ok");
    const r = result.rows[0];
    expect(r.label).toBe("Start → AS1");
    expect(r.segment_distance_km).toBe(40);
    expect(r.segment_elevation_gain_m).toBe(1000);
    expect(r.moving_minutes).toBeCloseTo(245.8333, 3); // 590·50/120
    expect(r.fluid_ml).toBeCloseTo(2048.611, 2); // 500·(245.8333/60)
    expect(r.carb_g).toBeCloseTo(245.833, 2);
    expect(r.sodium_mg).toBeCloseTo(2868.056, 2);
    expect(r.arrival).toBe("2026-09-01T10:05:50.000Z"); // 06:00 + 245.8333 min
    expect(r.endStation).not.toBeNull();
  });

  it("segment 2 (AS1 → Finish): distance/moving/arrival", () => {
    if (!result.ok) throw new Error("expected ok");
    const r = result.rows[1];
    expect(r.label).toBe("AS1 → Finish");
    expect(r.segment_distance_km).toBe(60);
    expect(r.segment_elevation_gain_m).toBe(1000);
    expect(r.moving_minutes).toBeCloseTo(344.1667, 3); // 590·70/120
    expect(r.arrival).toBe("2026-09-01T16:00:00.000Z");
    expect(r.endStation).toBeNull();
  });

  it("totals: moving = expected − rest, finish = start + expected", () => {
    if (!result.ok) throw new Error("expected ok");
    expect(result.totals.distance_km).toBe(100);
    expect(result.totals.elevation_gain_m).toBe(2000);
    expect(result.totals.rest_minutes).toBe(10);
    expect(result.totals.moving_minutes).toBeCloseTo(590, 6);
    expect(result.totals.finish_arrival).toBe("2026-09-01T16:00:00.000Z");
  });
});

describe("computePlanTable — edge cases", () => {
  it("zero aid stations → a single Start → Finish row", () => {
    const result = computePlanTable(makePlan(), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].label).toBe("Start → Finish");
    expect(result.rows[0].segment_distance_km).toBe(100);
    expect(result.rows[0].moving_minutes).toBeCloseTo(600, 6);
    expect(result.rows[0].fluid_ml).toBeCloseTo(5000, 6); // 500 · 10h
    expect(result.totals.finish_arrival).toBe("2026-09-01T16:00:00.000Z");
  });

  it("rest time shrinks moving budget but finish stays at start + expected", () => {
    const withRest = computePlanTable(makePlan(), [makeStation({ time_spent_min: 60 })]);
    const noRest = computePlanTable(makePlan(), [makeStation({ time_spent_min: 0 })]);
    if (!withRest.ok || !noRest.ok) throw new Error("expected ok");
    expect(withRest.totals.moving_minutes).toBeCloseTo(540, 6); // 600 − 60
    expect(noRest.totals.moving_minutes).toBeCloseTo(600, 6);
    expect(withRest.rows[0].moving_minutes).toBeLessThan(noRest.rows[0].moving_minutes);
    expect(withRest.totals.finish_arrival).toBe("2026-09-01T16:00:00.000Z");
  });

  it("missing required params → missing_params error", () => {
    expect(computePlanTable(makePlan({ total_distance_km: 0 }), []).ok).toBe(false);
    expect(computePlanTable(makePlan({ total_elevation_gain_m: 0 }), []).ok).toBe(false);
    const r = computePlanTable(makePlan({ total_expected_minutes: 0 }), []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing_params");
  });

  it("rest ≥ expected time → rest_exceeds_budget error", () => {
    const r = computePlanTable(makePlan({ total_expected_minutes: 600 }), [makeStation({ time_spent_min: 600 })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("rest_exceeds_budget");
  });

  it("a station exactly at the finish is dropped (no zero-length trailing row, no phantom rest)", () => {
    const r = computePlanTable(makePlan(), [makeStation({ cumulative_distance_km: 100, time_spent_min: 30 })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].label).toBe("Start → Finish");
    expect(r.totals.rest_minutes).toBe(0);
  });
});

describe("computePlanTable — elevation loss derivation (gpx-import)", () => {
  it("derives per-segment loss from cumulative loss; finish anchors on total loss", () => {
    // Manual plan (gpx_* null): factor = 1. Station at 40 km with cumulative
    // loss 800; finish loss = total_elevation_loss_m = 2000.
    const r = computePlanTable(makePlan(), [makeStation({ cumulative_elevation_loss_m: 800 })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].segment_elevation_loss_m).toBe(800); // 800 − 0
    expect(r.rows[1].segment_elevation_loss_m).toBe(1200); // 2000 − 800
    expect(r.totals.elevation_loss_m).toBe(2000);
  });

  it("a manual plan with no GPX is unchanged plus a loss column (factor = 1)", () => {
    // Zero stations → single Start → Finish segment carrying the whole loss.
    const r = computePlanTable(makePlan(), []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].segment_elevation_loss_m).toBe(2000);
    expect(r.totals.elevation_loss_m).toBe(2000);
    // Gain/distance assertions from the manual-era tests still hold.
    expect(r.totals.distance_km).toBe(100);
    expect(r.totals.elevation_gain_m).toBe(2000);
  });
});

describe("computePlanTable — calibration (gpx-import)", () => {
  // GPX plan: raw 200 km / 2000 m gain / 1000 m loss; corrected 220 / 2200 / 1100.
  // Every metric factor = 1.1. Station at GPX-cumulative 100 km / 1500 m gain /
  // 300 m loss (asymmetric so seg1 is the steeper leg).
  const gpxPlan = makePlan({
    total_distance_km: 220,
    total_elevation_gain_m: 2200,
    total_elevation_loss_m: 1100,
    gpx_distance_km: 200,
    gpx_elevation_gain_m: 2000,
    gpx_elevation_loss_m: 1000,
  });
  const result = computePlanTable(gpxPlan, [
    makeStation({ cumulative_distance_km: 100, cumulative_elevation_gain_m: 1500, cumulative_elevation_loss_m: 300 }),
  ]);

  it("scales each segment's distance/gain/loss by its calibration factor", () => {
    if (!result.ok) throw new Error("expected ok");
    const [s1, s2] = result.rows;
    expect(s1.segment_distance_km).toBeCloseTo(110, 6); // 1.1 · 100
    expect(s1.segment_elevation_gain_m).toBeCloseTo(1650, 6); // 1.1 · 1500
    expect(s1.segment_elevation_loss_m).toBeCloseTo(330, 6); // 1.1 · 300
    expect(s2.segment_distance_km).toBeCloseTo(110, 6); // 1.1 · (200 − 100)
    expect(s2.segment_elevation_gain_m).toBeCloseTo(550, 6); // 1.1 · (2000 − 1500)
    expect(s2.segment_elevation_loss_m).toBeCloseTo(770, 6); // 1.1 · (1000 − 300)
  });

  it("segment totals reconcile to the corrected (user-trusted) totals", () => {
    if (!result.ok) throw new Error("expected ok");
    expect(result.totals.distance_km).toBeCloseTo(220, 6);
    expect(result.totals.elevation_gain_m).toBeCloseTo(2200, 6);
    expect(result.totals.elevation_loss_m).toBeCloseTo(1100, 6);
  });

  it("feeds calibrated gain into the Naismith weight (steeper leg gets more moving time)", () => {
    if (!result.ok) throw new Error("expected ok");
    // weights: s1 = 110 + 0.01·1650 = 126.5; s2 = 110 + 0.01·550 = 115.5.
    expect(result.rows[0].moving_minutes).toBeGreaterThan(result.rows[1].moving_minutes);
    // Moving time is conserved regardless of calibration: Σ = expected − rest.
    expect(result.totals.moving_minutes).toBeCloseTo(600, 6);
  });
});

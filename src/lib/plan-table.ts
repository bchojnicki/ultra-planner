// Plan-table calculation (S-02) — the product wedge. Pure: no I/O, derives the
// segment-by-segment table from the persisted plan + aid stations per the PRD
// Business Logic. All arithmetic is floating point; rounding is the UI's job.
import type { AidStation, Plan, PlanTableResult, PlanTableRow, PlanTableTotals } from "@/types";

// Naismith weight: 10 m of ascent ≈ 0.1 km of flat distance → k = 0.01 km/m.
export const SEGMENT_ELEVATION_WEIGHT_K = 0.01;

interface Point {
  distance_km: number;
  elevation_gain_m: number;
  station: AidStation | null; // null for the race start and finish
  label: string;
}

interface Segment {
  from: Point;
  to: Point;
  distance: number;
  gain: number;
  weight: number;
}

export function computePlanTable(plan: Plan, stations: AidStation[]): PlanTableResult {
  // Required parameters. distance > 0 also guarantees a positive total weight.
  if (plan.total_distance_km <= 0 || plan.total_elevation_gain_m <= 0 || plan.total_expected_minutes <= 0) {
    return {
      ok: false,
      error: "missing_params",
      message: "Enter total distance, elevation gain, and expected finish time to generate your plan.",
    };
  }

  // Only stations strictly inside the course form boundaries; sort by distance.
  const inside = stations
    .filter((s) => s.cumulative_distance_km > 0 && s.cumulative_distance_km < plan.total_distance_km)
    .slice()
    .sort((a, b) => a.cumulative_distance_km - b.cumulative_distance_km);

  // total time = moving time + rest time → rest eats into the moving budget.
  const rest_minutes = inside.reduce((sum, s) => sum + s.time_spent_min, 0);
  const moving_minutes = plan.total_expected_minutes - rest_minutes;
  if (moving_minutes <= 0) {
    return {
      ok: false,
      error: "rest_exceeds_budget",
      message:
        "Planned rest time meets or exceeds the expected finish time. Reduce time at aid stations or increase the expected finish time.",
    };
  }

  const points: Point[] = [
    { distance_km: 0, elevation_gain_m: 0, station: null, label: "Start" },
    ...inside.map((s, i) => ({
      distance_km: s.cumulative_distance_km,
      elevation_gain_m: s.cumulative_elevation_gain_m,
      station: s,
      label: `AS${i + 1}`,
    })),
    {
      distance_km: plan.total_distance_km,
      elevation_gain_m: plan.total_elevation_gain_m,
      station: null,
      label: "Finish",
    },
  ];

  // Pair consecutive points into segments, skipping zero/negative-length legs
  // (a station exactly at the finish, or duplicate cumulative distances).
  const segments: Segment[] = [];
  let prev: Point | null = null;
  for (const pt of points) {
    if (prev !== null) {
      const distance = pt.distance_km - prev.distance_km;
      if (distance > 0) {
        const gain = Math.max(0, pt.elevation_gain_m - prev.elevation_gain_m);
        segments.push({ from: prev, to: pt, distance, gain, weight: distance + SEGMENT_ELEVATION_WEIGHT_K * gain });
      }
    }
    prev = pt;
  }

  const totalWeight = segments.reduce((sum, s) => sum + s.weight, 0);

  const startMs = new Date(plan.start_time).getTime();
  if (Number.isNaN(startMs)) {
    return { ok: false, error: "missing_params", message: "Enter a valid race start time to generate your plan." };
  }
  let elapsedMin = 0; // moving + rest accumulated from the start
  const rows: PlanTableRow[] = segments.map((seg) => {
    const moving = moving_minutes * (seg.weight / totalWeight);
    const hours = moving / 60;
    elapsedMin += moving; // travel this segment
    const arrival = new Date(startMs + elapsedMin * 60_000).toISOString();
    // Rest is taken after arriving at an intermediate station, before the next leg.
    if (seg.to.station) elapsedMin += seg.to.station.time_spent_min;
    return {
      label: `${seg.from.label} → ${seg.to.label}`,
      segment_distance_km: seg.distance,
      segment_elevation_gain_m: seg.gain,
      moving_minutes: moving,
      arrival,
      fluid_ml: plan.hourly_fluid_ml * hours,
      carb_g: plan.hourly_carb_g * hours,
      sodium_mg: plan.hourly_sodium_mg * hours,
      endStation: seg.to.station,
    };
  });

  const totals: PlanTableTotals = {
    distance_km: rows.reduce((s, r) => s + r.segment_distance_km, 0),
    elevation_gain_m: rows.reduce((s, r) => s + r.segment_elevation_gain_m, 0),
    moving_minutes: rows.reduce((s, r) => s + r.moving_minutes, 0),
    rest_minutes,
    fluid_ml: rows.reduce((s, r) => s + r.fluid_ml, 0),
    carb_g: rows.reduce((s, r) => s + r.carb_g, 0),
    sodium_mg: rows.reduce((s, r) => s + r.sodium_mg, 0),
    // moving + rest == total_expected_minutes, so finish lands exactly at start + expected.
    finish_arrival: new Date(startMs + (moving_minutes + rest_minutes) * 60_000).toISOString(),
  };

  return { ok: true, rows, totals };
}

// @vitest-environment jsdom
// Golden-number tests for the GPX parse + compute module (gpx-import, Phase 2).
// The math expectations are hand-derived from the haversine/delta-sum contract,
// independent of the implementation. parseGpx needs a DOM, hence the jsdom env
// pragma above; the math functions are pure and DOM-free.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  distance3dKm,
  elevationGainLoss,
  parseGpx,
  projectWaypointsToStations,
  type GpxPoint,
  type GpxWaypoint,
} from "../../src/lib/gpx";

// One degree of latitude ≈ π/180 · 6_371_000 m ≈ 111_194.93 m.
const DEG_LAT_M = (Math.PI / 180) * 6_371_000;

describe("distance3dKm", () => {
  it("is 0 for an empty or single-point track", () => {
    expect(distance3dKm([])).toBe(0);
    expect(distance3dKm([{ lat: 0, lon: 0, ele: 0 }])).toBe(0);
  });

  it("measures a flat leg as the 2D great-circle distance", () => {
    const km = distance3dKm([
      { lat: 0, lon: 0, ele: 0 },
      { lat: 1, lon: 0, ele: 0 },
    ]);
    expect(km).toBeCloseTo(DEG_LAT_M / 1000, 2);
  });

  it("counts pure vertical change with no horizontal movement", () => {
    const km = distance3dKm([
      { lat: 0, lon: 0, ele: 0 },
      { lat: 0, lon: 0, ele: 300 },
    ]);
    expect(km).toBeCloseTo(0.3, 6);
  });

  it("combines horizontal and vertical as the leg hypotenuse", () => {
    const km = distance3dKm([
      { lat: 0, lon: 0, ele: 0 },
      { lat: 1, lon: 0, ele: 300 },
    ]);
    const expected = Math.sqrt(DEG_LAT_M * DEG_LAT_M + 300 * 300) / 1000;
    expect(km).toBeCloseTo(expected, 6);
  });
});

describe("elevationGainLoss", () => {
  it("sums only positive deltas for a monotonic climb", () => {
    const track: GpxPoint[] = [0, 100, 250].map((ele) => ({ lat: 0, lon: 0, ele }));
    expect(elevationGainLoss(track)).toEqual({ gain_m: 250, loss_m: 0 });
  });

  it("sums only |negative| deltas for a descent", () => {
    const track: GpxPoint[] = [250, 100, 0].map((ele) => ({ lat: 0, lon: 0, ele }));
    expect(elevationGainLoss(track)).toEqual({ gain_m: 0, loss_m: 250 });
  });

  it("delta-sums a noisy zig-zag exactly (no threshold)", () => {
    // deltas: +100, -50, +100, -50 → gain 200, loss 100
    const track: GpxPoint[] = [0, 100, 50, 150, 100].map((ele) => ({ lat: 0, lon: 0, ele }));
    expect(elevationGainLoss(track)).toEqual({ gain_m: 200, loss_m: 100 });
  });
});

describe("projectWaypointsToStations", () => {
  // P0 (0,0,0) → P1 (0,1,100) → P2 (0,2,50): two ~1° eastward legs.
  const track: GpxPoint[] = [
    { lat: 0, lon: 0, ele: 0 },
    { lat: 0, lon: 1, ele: 100 },
    { lat: 0, lon: 2, ele: 50 },
  ];
  const distP1 = Math.sqrt(DEG_LAT_M * DEG_LAT_M + 100 * 100) / 1000;

  it("snaps an on-track waypoint to its point and reads cumulative values there", () => {
    const wp: GpxWaypoint = { lat: 0, lon: 1, ele: 100, name: "AS1" };
    const [station] = projectWaypointsToStations(track, [wp]);
    expect(station.cumulative_distance_km).toBeCloseTo(distP1, 4);
    expect(station.cumulative_elevation_gain_m).toBe(100);
    expect(station.cumulative_elevation_loss_m).toBe(0);
    expect(station.notes).toBe("AS1");
  });

  it("snaps an off-track waypoint to the nearest track point", () => {
    // Slightly off P0; nearest is the start → all cumulative values 0.
    const wp: GpxWaypoint = { lat: 0.0001, lon: 0, ele: 0, name: "Start area" };
    const [station] = projectWaypointsToStations(track, [wp]);
    expect(station.cumulative_distance_km).toBe(0);
    expect(station.cumulative_elevation_gain_m).toBe(0);
    expect(station.cumulative_elevation_loss_m).toBe(0);
  });

  it("returns stations sorted by cumulative distance regardless of input order", () => {
    const far: GpxWaypoint = { lat: 0, lon: 1, ele: 100, name: "far" };
    const near: GpxWaypoint = { lat: 0.0001, lon: 0, ele: 0, name: "near" };
    const stations = projectWaypointsToStations(track, [far, near]);
    expect(stations.map((s) => s.notes)).toEqual(["near", "far"]);
    expect(stations[0].cumulative_distance_km).toBeLessThan(stations[1].cumulative_distance_km);
  });

  it("returns nothing when the track is empty", () => {
    expect(projectWaypointsToStations([], [{ lat: 0, lon: 0, ele: 0, name: "x" }])).toEqual([]);
  });
});

describe("parseGpx", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="0.0" lon="1.0"><ele>100</ele><name>Checkpoint</name></wpt>
  <trk><trkseg>
    <trkpt lat="0.0" lon="0.0"><ele>0</ele></trkpt>
    <trkpt lat="0.0" lon="1.0"><ele>100</ele></trkpt>
  </trkseg></trk>
</gpx>`;

  it("extracts track points (across trkseg) and waypoints with names", () => {
    const { track, waypoints } = parseGpx(xml);
    expect(track).toHaveLength(2);
    expect(track[1]).toEqual({ lat: 0, lon: 1, ele: 100 });
    expect(waypoints).toHaveLength(1);
    expect(waypoints[0].name).toBe("Checkpoint");
    expect(waypoints[0].ele).toBe(100);
  });

  it("defaults missing elevation to 0", () => {
    const { track } = parseGpx(
      `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>` +
        `<trkpt lat="1.0" lon="2.0"></trkpt></trkseg></trk></gpx>`,
    );
    expect(track[0]).toEqual({ lat: 1, lon: 2, ele: 0 });
  });

  it("throws on malformed XML", () => {
    expect(() => parseGpx("<gpx><trk>")).toThrow();
  });
});

// --- End-to-end fixture (G1) + true-geodetic anchor (G2), rollout Phase 2, Risk #2. ---
// Closes the gap that the three pure functions are only tested in isolation, never on a
// whole .gpx file. Oracle is independent: DEG_LAT_M is re-derived from first principles
// above; each leg's 3D distance is the documented contract sqrt(2d² + Δele²) hand-assembled
// from the equator course (every leg = 1° of longitude); gain/loss are exact integers.
// Fixture: tests/fixtures/sample-course.gpx.

// Resolved from the project root (vitest's working directory), not import.meta.url —
// the jsdom env reports a non-file URL for this module.
const FIXTURE_XML = readFileSync("tests/fixtures/sample-course.gpx", "utf-8");

// Hand-derived oracle (L = one degree at the equator = DEG_LAT_M):
const L = DEG_LAT_M;
const leg = (dEle: number): number => Math.sqrt(L * L + dEle * dEle);
const legKm = [leg(100), leg(200), leg(150), leg(100)].map((m) => m / 1000); // Δele: +100,+200,-150,+100
const totalKm = legKm.reduce((a, b) => a + b, 0);
const as1Km = legKm[0] + legKm[1]; // cumulative to P2 (waypoint AS1)
const as2Km = legKm[0] + legKm[1] + legKm[2]; // cumulative to P3 (waypoint AS2)

describe("GPX extraction end-to-end (fixture)", () => {
  const { track, waypoints } = parseGpx(FIXTURE_XML);

  it("G1a parses every trkpt across both trksegs and both named waypoints", () => {
    expect(track).toHaveLength(5);
    expect(track.map((p) => p.ele)).toEqual([0, 100, 300, 150, 250]);
    expect(waypoints.map((w) => w.name)).toEqual(["AS1", "AS2"]);
  });

  it("G1b totals reconcile to the hand-computed distance, gain, and loss", () => {
    expect(distance3dKm(track)).toBeCloseTo(totalKm, 4);
    expect(elevationGainLoss(track)).toEqual({ gain_m: 400, loss_m: 150 });
  });

  it("G1c projects on-point waypoints to their exact cumulative values, sorted by distance", () => {
    const stations = projectWaypointsToStations(track, waypoints);
    expect(stations.map((s) => s.notes)).toEqual(["AS1", "AS2"]);
    expect(stations[0].cumulative_distance_km).toBeCloseTo(as1Km, 4);
    expect(stations[0].cumulative_elevation_gain_m).toBe(300); // +100 +200
    expect(stations[0].cumulative_elevation_loss_m).toBe(0);
    expect(stations[1].cumulative_distance_km).toBeCloseTo(as2Km, 4);
    expect(stations[1].cumulative_elevation_gain_m).toBe(300); // leg P2→P3 is negative
    expect(stations[1].cumulative_elevation_loss_m).toBe(150);
  });

  it("G2 measures a 1° latitude leg against the published geodetic distance (~111.19 km)", () => {
    // External oracle: 1° of latitude ≈ 111.19 km on a 6,371 km sphere — a published
    // literal, NOT the re-derived DEG_LAT_M, so it pins the earth-radius constant itself
    // beyond the small-angle limit the other tests share with the source.
    const km = distance3dKm([
      { lat: 0, lon: 0, ele: 0 },
      { lat: 1, lon: 0, ele: 0 },
    ]);
    expect(km).toBeCloseTo(111.19, 1);
  });
});

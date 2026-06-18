// GPX parse + compute (gpx-import, Phase 2). Pure, browser-side primitives the
// upload UI calls. The file is parsed in the browser (DOMParser) and only the
// small computed numbers are POSTed — the raw file never leaves the client.
//
// Two layers, kept apart so the math unit-tests in Node without a DOM:
//   - parseGpx: the one DOM-dependent function (XML → arrays of points).
//   - distance3dKm / elevationGainLoss / projectWaypointsToStations: pure
//     array-in → numbers-out coordinate math.
//
// Scope (plan "What We're NOT Doing"): only <trk>/<trkpt> tracks and <wpt>
// waypoints; no <rte> routes, no smoothing/threshold filtering, no 2D distance.

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number;
}

export type GpxWaypoint = GpxPoint & { name: string };

// One projected aid station: cumulative measurements from the start of the
// track up to the waypoint's nearest track point. Shape matches the station
// items in gpxImportSchema (src/lib/schemas.ts).
export interface StationImport {
  cumulative_distance_km: number;
  cumulative_elevation_gain_m: number;
  cumulative_elevation_loss_m: number;
  notes: string;
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle 2D distance between two points, in meters (haversine).
function haversine2dMeters(a: GpxPoint, b: GpxPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Pure coordinate math (no DOM).
// ---------------------------------------------------------------------------

// Total 3D track length in km: per leg, sqrt(2d-haversine² + Δelevation²).
export function distance3dKm(track: GpxPoint[]): number {
  let meters = 0;
  for (let i = 1; i < track.length; i++) {
    const flat = haversine2dMeters(track[i - 1], track[i]);
    const dEle = track[i].ele - track[i - 1].ele;
    meters += Math.sqrt(flat * flat + dEle * dEle);
  }
  return meters / 1000;
}

// Pure delta-sum (no threshold): gain = Σ positive Δele, loss = Σ |negative Δele|.
export function elevationGainLoss(track: GpxPoint[]): { gain_m: number; loss_m: number } {
  let gain_m = 0;
  let loss_m = 0;
  for (let i = 1; i < track.length; i++) {
    const dEle = track[i].ele - track[i - 1].ele;
    if (dEle > 0) gain_m += dEle;
    else loss_m += -dEle;
  }
  return { gain_m, loss_m };
}

// Cumulative distance/gain/loss over track[0..index] inclusive.
function cumulativeAt(
  track: GpxPoint[],
  index: number,
): {
  cumulative_distance_km: number;
  cumulative_elevation_gain_m: number;
  cumulative_elevation_loss_m: number;
} {
  const slice = track.slice(0, index + 1);
  const { gain_m, loss_m } = elevationGainLoss(slice);
  return {
    cumulative_distance_km: distance3dKm(slice),
    cumulative_elevation_gain_m: gain_m,
    cumulative_elevation_loss_m: loss_m,
  };
}

// For each waypoint, snap to the nearest track point (2D haversine) and take the
// cumulative distance/gain/loss along the track up to that index. Returns
// stations sorted by cumulative distance; notes carries the waypoint name.
export function projectWaypointsToStations(track: GpxPoint[], waypoints: GpxWaypoint[]): StationImport[] {
  if (track.length === 0) return [];
  return waypoints
    .map((wp) => {
      let nearestIndex = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < track.length; i++) {
        const d = haversine2dMeters(track[i], wp);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIndex = i;
        }
      }
      return { ...cumulativeAt(track, nearestIndex), notes: wp.name };
    })
    .sort((a, b) => a.cumulative_distance_km - b.cumulative_distance_km);
}

// ---------------------------------------------------------------------------
// DOM-dependent parse (browser). Isolated so the math above stays testable in
// Node; tests that exercise this path opt into a DOM env (// @vitest-environment jsdom).
// ---------------------------------------------------------------------------

function textOf(parent: Element, tag: string): string | null {
  // Local-name match is namespace-agnostic, so GPX's default xmlns is handled.
  return parent.getElementsByTagName(tag).item(0)?.textContent ?? null;
}

function toPoint(el: Element): GpxPoint {
  const ele = textOf(el, "ele");
  return {
    lat: Number(el.getAttribute("lat")),
    lon: Number(el.getAttribute("lon")),
    ele: ele === null ? 0 : Number(ele),
  };
}

// Parse GPX XML into ordered track points (all <trkpt>, across every <trkseg>)
// and waypoints (<wpt>). Throws on malformed XML.
export function parseGpx(xml: string): { track: GpxPoint[]; waypoints: GpxWaypoint[] } {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Invalid GPX file: could not parse XML.");
  }

  const track = Array.from(doc.getElementsByTagName("trkpt")).map(toPoint);
  const waypoints = Array.from(doc.getElementsByTagName("wpt")).map((el) => ({
    ...toPoint(el),
    name: textOf(el, "name") ?? "",
  }));

  return { track, waypoints };
}

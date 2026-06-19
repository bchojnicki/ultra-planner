// Shared display formatting for distance and elevation. Single source of truth so
// every surface rounds identically — distance to 0.1 km, elevation to whole metres.
// Display-only: the stored values and the calc keep full float precision (accuracy
// guardrail). Importable by both .tsx and .astro components.

// Distance in km, rounded to 0.1 km (100 m).
export function fmtKm(km: number): string {
  return String(Math.round(km * 10) / 10);
}

// Elevation in metres, rounded to whole metres.
export function fmtM(m: number): string {
  return String(Math.round(m));
}

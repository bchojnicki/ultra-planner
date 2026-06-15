// Zod request-validation schemas for the race-setup API endpoints (S-01).
// Fields and units mirror the F-01 DTOs in src/types.ts. Schemas reject unknown
// keys (z.strictObject) so malformed/extra fields fail fast at the endpoint.
import { z } from "zod";

const nonNegative = z.number().min(0);

// Plan parameter autosave: every field optional (mirrors PlanUpdate). The form
// PATCHes only the field(s) that changed. start_time arrives as an ISO string
// (the island converts the datetime-local input via Date.toISOString()).
export const planUpdateSchema = z.strictObject({
  name: z.string().min(1).optional(),
  total_distance_km: nonNegative.optional(),
  total_elevation_gain_m: nonNegative.optional(),
  total_elevation_loss_m: nonNegative.optional(),
  start_time: z.iso.datetime().optional(),
  total_expected_minutes: z.number().int().min(0).optional(),
  hourly_fluid_ml: nonNegative.optional(),
  hourly_carb_g: nonNegative.optional(),
  hourly_sodium_mg: nonNegative.optional(),
});

// Aid-station creation: the two cumulative measurements are required; the rest
// carry DB defaults (time/flags) or are nullable (notes). plan_id comes from the
// route param, not the body.
export const aidStationCreateSchema = z.strictObject({
  cumulative_distance_km: nonNegative,
  cumulative_elevation_gain_m: nonNegative,
  time_spent_min: nonNegative.optional(),
  water_only: z.boolean().optional(),
  food_available: z.boolean().optional(),
  warm_meal: z.boolean().optional(),
  drop_bag_available: z.boolean().optional(),
  rest_area: z.boolean().optional(),
  support_crew_allowed: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;
export type AidStationCreateInput = z.infer<typeof aidStationCreateSchema>;

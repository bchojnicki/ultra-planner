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
  cumulative_elevation_loss_m: nonNegative.optional(),
  time_spent_min: nonNegative.optional(),
  water_only: z.boolean().optional(),
  food_available: z.boolean().optional(),
  warm_meal: z.boolean().optional(),
  drop_bag_available: z.boolean().optional(),
  rest_area: z.boolean().optional(),
  support_crew_allowed: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

// Aid-station edit (edit-aid-stations). Every field optional so the client PATCHes
// only what changed; mirrors aidStationCreateSchema but with the two cumulative
// measurements optional too. plan_id / identity fields are not editable.
export const aidStationUpdateSchema = z.strictObject({
  cumulative_distance_km: nonNegative.optional(),
  cumulative_elevation_gain_m: nonNegative.optional(),
  cumulative_elevation_loss_m: nonNegative.optional(),
  time_spent_min: nonNegative.optional(),
  water_only: z.boolean().optional(),
  food_available: z.boolean().optional(),
  warm_meal: z.boolean().optional(),
  drop_bag_available: z.boolean().optional(),
  rest_area: z.boolean().optional(),
  support_crew_allowed: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

// GPX import (gpx-import). The dedicated import endpoint receives the raw
// GPX-computed totals (the calibration delta's denominator), the corrected
// totals to write onto the plan, and the projected waypoint stations. plan_id
// comes from the route param, not the body. gpx_* are written only here — they
// are intentionally absent from planUpdateSchema so autosave can never overwrite
// the delta denominator.
const gpxStationSchema = z.strictObject({
  cumulative_distance_km: nonNegative,
  cumulative_elevation_gain_m: nonNegative,
  cumulative_elevation_loss_m: nonNegative,
  notes: z.string().nullable().optional(),
});

export const gpxImportSchema = z.strictObject({
  gpx_distance_km: nonNegative,
  gpx_elevation_gain_m: nonNegative,
  gpx_elevation_loss_m: nonNegative,
  total_distance_km: nonNegative,
  total_elevation_gain_m: nonNegative,
  total_elevation_loss_m: nonNegative,
  stations: z.array(gpxStationSchema),
});

// Gear catalog (S-03). A gear item create requires kind + name; the per-unit
// nutrition fields are optional/nullable (which apply depends on the kind, enforced
// by the UI), and carb_ratio has a DB default. plan_id comes from the route param.
const gearKind = z.enum(["gel", "drink", "solid_food", "water_carrier", "salt_cap"]);
const nonNegativeNullable = z.number().min(0).nullable();

export const gearItemCreateSchema = z.strictObject({
  kind: gearKind,
  name: z.string().min(1),
  carb_g: nonNegativeNullable.optional(),
  sodium_mg: nonNegativeNullable.optional(),
  fluid_ml: nonNegativeNullable.optional(),
  capacity_ml: nonNegativeNullable.optional(),
  carb_ratio: nonNegative.optional(),
});

// Gear item update: every field optional (mirrors GearItemUpdate). kind is editable.
export const gearItemUpdateSchema = z.strictObject({
  kind: gearKind.optional(),
  name: z.string().min(1).optional(),
  carb_g: nonNegativeNullable.optional(),
  sodium_mg: nonNegativeNullable.optional(),
  fluid_ml: nonNegativeNullable.optional(),
  capacity_ml: nonNegativeNullable.optional(),
  carb_ratio: nonNegative.optional(),
});

// Per-segment selection upsert: identify the (gear item, segment); carry the optional
// cap and/or pin. Whole-unit integers only. An empty pair (both null/absent) signals the
// endpoint to delete any existing row (the sparse-row contract). plan_id is the route param.
const nonNegativeIntNullable = z.number().int().min(0).nullable();

export const gearSelectionUpsertSchema = z.strictObject({
  gear_item_id: z.uuid(),
  segment_index: z.number().int().min(0),
  limit_units: nonNegativeIntNullable.optional(),
  override_units: nonNegativeIntNullable.optional(),
});

// Account deletion (account-deletion). The verify step carries the OTP re-auth
// code the user received by email; the request step needs no body (the user is
// identified by their session).
export const accountDeletionVerifySchema = z.strictObject({
  code: z.string().min(1),
});

export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;
export type AidStationCreateInput = z.infer<typeof aidStationCreateSchema>;
export type AidStationUpdateInput = z.infer<typeof aidStationUpdateSchema>;
export type GpxImportInput = z.infer<typeof gpxImportSchema>;
export type GearItemCreateInput = z.infer<typeof gearItemCreateSchema>;
export type GearItemUpdateInput = z.infer<typeof gearItemUpdateSchema>;
export type GearSelectionUpsertInput = z.infer<typeof gearSelectionUpsertSchema>;
export type AccountDeletionVerifyInput = z.infer<typeof accountDeletionVerifySchema>;

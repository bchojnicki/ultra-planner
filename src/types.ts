// Shared entity + DTO types for the persisted data layer (F-01).
// Hand-authored to mirror supabase/migrations/20260603132423_create_plans_and_aid_stations.sql
// column-for-column. Field names are snake_case to match the rows the Supabase client returns.
//
// Units: distance in km, elevation in m, finish time in whole minutes, fluid in ml,
// carbohydrate in g, sodium in mg. (timestamptz columns surface as ISO strings.)

// NOTE: entity rows are `type` aliases, not `interface`. Supabase's GenericTable requires
// Row/Insert/Update to be assignable to Record<string, unknown>; object-literal type aliases
// satisfy that, but interfaces do not (no implicit index signature) — which would silently
// collapse the typed client's table types to `never`.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- must be a type alias (see note above)
export type Plan = {
  id: string;
  user_id: string;
  name: string;
  total_distance_km: number;
  total_elevation_gain_m: number;
  total_elevation_loss_m: number;
  // Raw GPX-computed totals (NULL = no GPX imported). The total_* columns above
  // are the user-correctable values; these hold the original GPX numbers so the
  // per-metric calibration delta (corrected - gpx)/gpx stays computable.
  gpx_distance_km: number | null;
  gpx_elevation_gain_m: number | null;
  gpx_elevation_loss_m: number | null;
  start_time: string;
  total_expected_minutes: number;
  hourly_fluid_ml: number;
  hourly_carb_g: number;
  hourly_sodium_mg: number;
  created_at: string;
  updated_at: string;
};

// Insert: server-managed columns (id, created_at, updated_at) are omitted.
// user_id is required — the RLS WITH CHECK (user_id = auth.uid()) only permits a runner
// to insert rows owned by themselves; the caller supplies their own id from the session.
// The gpx_* columns are nullable (DB default NULL) — optional here; they are written
// only by the GPX import flow, not at plan creation.
export type PlanInsert = Omit<
  Plan,
  "id" | "created_at" | "updated_at" | "gpx_distance_km" | "gpx_elevation_gain_m" | "gpx_elevation_loss_m"
> &
  Partial<Pick<Plan, "gpx_distance_km" | "gpx_elevation_gain_m" | "gpx_elevation_loss_m">>;

// Update: every mutable field is optional; id/user_id/timestamps are not user-editable.
export type PlanUpdate = Partial<Omit<Plan, "id" | "user_id" | "created_at" | "updated_at">>;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- must be a type alias (see Plan note)
export type AidStation = {
  id: string;
  plan_id: string;
  cumulative_distance_km: number;
  cumulative_elevation_gain_m: number;
  cumulative_elevation_loss_m: number;
  time_spent_min: number;
  water_only: boolean;
  food_available: boolean;
  warm_meal: boolean;
  drop_bag_available: boolean;
  rest_area: boolean;
  support_crew_allowed: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Insert: id/created_at/updated_at are server-managed. plan_id and the two cumulative
// measurements are required; time_spent_min and the six facility flags carry DB defaults,
// and notes is nullable — all optional here.
export type AidStationInsert = Omit<
  AidStation,
  | "id"
  | "created_at"
  | "updated_at"
  | "cumulative_elevation_loss_m"
  | "time_spent_min"
  | "water_only"
  | "food_available"
  | "warm_meal"
  | "drop_bag_available"
  | "rest_area"
  | "support_crew_allowed"
  | "notes"
> &
  Partial<
    Pick<
      AidStation,
      | "cumulative_elevation_loss_m"
      | "time_spent_min"
      | "water_only"
      | "food_available"
      | "warm_meal"
      | "drop_bag_available"
      | "rest_area"
      | "support_crew_allowed"
      | "notes"
    >
  >;

// Update: every mutable field is optional; id/plan_id/timestamps are not user-editable.
export type AidStationUpdate = Partial<Omit<AidStation, "id" | "plan_id" | "created_at" | "updated_at">>;

// ---------------------------------------------------------------------------
// Gear catalog (S-03). A per-plan list of fueling items; the plan table's
// unit-level output is derived from these plus per-segment selections below.
// Mirrors supabase/migrations/20260616073640_create_gear_items.sql.
// Per-kind nutrition fields are nullable: a gel carries carb_g/sodium_mg, a
// water carrier only capacity_ml, a salt cap only sodium_mg, etc.
// ---------------------------------------------------------------------------

// The five fueling item kinds. gel/solid_food carry carbs (+ optional sodium);
// drink carries carbs + fluid (+ optional sodium); water_carrier carries fluid
// capacity only; salt_cap carries sodium only.
export type GearKind = "gel" | "drink" | "solid_food" | "water_carrier" | "salt_cap";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- must be a type alias (see Plan note)
export type GearItem = {
  id: string;
  plan_id: string;
  kind: GearKind;
  name: string;
  carb_g: number | null;
  sodium_mg: number | null;
  fluid_ml: number | null;
  capacity_ml: number | null;
  carb_ratio: number;
  created_at: string;
  updated_at: string;
};

// Insert: server-managed columns omitted. plan_id/kind/name are required; the per-unit
// nutrition fields are nullable (omitted → NULL) and carb_ratio has a DB default — all optional here.
export type GearItemInsert = Omit<
  GearItem,
  "id" | "created_at" | "updated_at" | "carb_g" | "sodium_mg" | "fluid_ml" | "capacity_ml" | "carb_ratio"
> &
  Partial<Pick<GearItem, "carb_g" | "sodium_mg" | "fluid_ml" | "capacity_ml" | "carb_ratio">>;

// Update: every mutable field is optional; id/plan_id/timestamps are not user-editable.
export type GearItemUpdate = Partial<Omit<GearItem, "id" | "plan_id" | "created_at" | "updated_at">>;

// ---------------------------------------------------------------------------
// Per-segment gear selections (S-03). Sparse: a row exists only when the runner
// deviates from the live suggestion for a (gear item, segment) — a per-stage unit
// cap (limit_units) and/or an exact pin (override_units). Absence = use suggestion.
// Mirrors supabase/migrations/20260616073641_create_gear_segment_selections.sql.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- must be a type alias (see Plan note)
export type GearSegmentSelection = {
  id: string;
  plan_id: string;
  gear_item_id: string;
  segment_index: number;
  limit_units: number | null;
  override_units: number | null;
  created_at: string;
  updated_at: string;
};

// Insert: server-managed columns omitted. plan_id/gear_item_id/segment_index are
// required; the limit/override are nullable (omitted → NULL) — optional here.
export type GearSegmentSelectionInsert = Omit<
  GearSegmentSelection,
  "id" | "created_at" | "updated_at" | "limit_units" | "override_units"
> &
  Partial<Pick<GearSegmentSelection, "limit_units" | "override_units">>;

// Update: every mutable field is optional; id and the identifying keys are not user-editable.
export type GearSegmentSelectionUpdate = Partial<
  Omit<GearSegmentSelection, "id" | "plan_id" | "gear_item_id" | "segment_index" | "created_at" | "updated_at">
>;

// ---------------------------------------------------------------------------
// Gear allocation result (S-03). Pure, derived per segment by
// src/lib/gear-allocation.ts — never persisted. Converts a segment's gram/ml
// targets into whole-unit suggestions per gear item, and reports what those
// units actually deliver (achieved) vs the target (delta = achieved − target).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias, mirrors the row-types convention above
export type GearNutrients = {
  carb_g: number;
  fluid_ml: number;
  sodium_mg: number;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias (see note above)
export type GearAllocationUnit = {
  gear_item_id: string;
  units: number; // whole units suggested for this item on this segment (may be 0)
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias (see note above)
export type GearAllocationResult = {
  units: GearAllocationUnit[]; // one entry per input item, in input order
  achieved: GearNutrients; // totals delivered by the suggested units
  delta: GearNutrients; // achieved − target (signed; negative = under-fuelled)
};

// ---------------------------------------------------------------------------
// Generated plan table (S-02). Derived, never persisted — computed on read by
// src/lib/plan-table.ts. All numeric fields are exact floats (rounding is a
// display concern); timestamps are ISO strings.
// ---------------------------------------------------------------------------

// One leg of the race: start→first station, station→station, or last station→finish.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias, mirrors the row-types convention above
export type PlanTableRow = {
  label: string; // e.g. "Start → AS1", "AS1 → AS2", "AS3 → Finish"
  segment_distance_km: number;
  segment_elevation_gain_m: number;
  segment_elevation_loss_m: number;
  moving_minutes: number;
  arrival: string; // ISO clock arrival at the end of this segment
  fluid_ml: number;
  carb_g: number;
  sodium_mg: number;
  endStation: AidStation | null; // the station this segment arrives at; null = finish
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- type alias (see note above)
export type PlanTableTotals = {
  distance_km: number;
  elevation_gain_m: number;
  elevation_loss_m: number;
  moving_minutes: number;
  rest_minutes: number;
  fluid_ml: number;
  carb_g: number;
  sodium_mg: number;
  finish_arrival: string; // ISO; equals start_time + total_expected_minutes
};

// Discriminated result: a renderable table, or an error the UI surfaces as a prompt.
export type PlanTableResult =
  | { ok: true; rows: PlanTableRow[]; totals: PlanTableTotals }
  | { ok: false; error: "missing_params" | "rest_exceeds_budget"; message: string };

// Minimal Supabase Database type so the SSR client is typed (no generated database.types.ts).
// Threaded through createClient() in src/lib/supabase.ts; gives `.from("plans")` typed
// Row/Insert/Update inference and eliminates `any` in the data-access layer.
export interface Database {
  public: {
    Tables: {
      plans: {
        Row: Plan;
        Insert: PlanInsert;
        Update: PlanUpdate;
        Relationships: [];
      };
      aid_stations: {
        Row: AidStation;
        Insert: AidStationInsert;
        Update: AidStationUpdate;
        Relationships: [];
      };
      gear_items: {
        Row: GearItem;
        Insert: GearItemInsert;
        Update: GearItemUpdate;
        Relationships: [];
      };
      gear_segment_selections: {
        Row: GearSegmentSelection;
        Insert: GearSegmentSelectionInsert;
        Update: GearSegmentSelectionUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

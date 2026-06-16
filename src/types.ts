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
export type PlanInsert = Omit<Plan, "id" | "created_at" | "updated_at">;

// Update: every mutable field is optional; id/user_id/timestamps are not user-editable.
export type PlanUpdate = Partial<Omit<Plan, "id" | "user_id" | "created_at" | "updated_at">>;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- must be a type alias (see Plan note)
export type AidStation = {
  id: string;
  plan_id: string;
  cumulative_distance_km: number;
  cumulative_elevation_gain_m: number;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

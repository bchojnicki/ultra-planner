// Data-access layer for `plans`. Every function takes the request-scoped Supabase
// client (from createClient(headers, cookies) in src/lib/supabase.ts) so the user's
// session is attached and RLS enforces owner-scoping on each query — app code never
// filters by user_id. Functions throw on Supabase errors so callers handle failure.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Plan, PlanInsert, PlanUpdate } from "@/types";

type Client = SupabaseClient<Database>;

export async function listPlans(client: Client): Promise<Plan[]> {
  const { data, error } = await client.from("plans").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getPlan(client: Client, id: string): Promise<Plan | null> {
  const { data, error } = await client.from("plans").select("*").eq("id", id).maybeSingle();
  // A malformed id (not a valid uuid) surfaces as Postgres 22P02; treat it as
  // "no such plan" so callers redirect like any missing plan, rather than a 500
  // with a stack trace. Real failures still throw.
  if (error) {
    if (error.code === "22P02") return null;
    throw error;
  }
  return data;
}

export async function createPlan(client: Client, input: PlanInsert): Promise<Plan> {
  const res = await client.from("plans").insert(input).select().single();
  if (res.error) throw res.error;
  return res.data;
}

// Create a draft plan with seeded defaults. The F-01 `plans` columns are all
// NOT NULL, so a partial draft can't be persisted as NULLs without a migration;
// instead the row is created with placeholders that autosave (PATCH) overwrites
// as the runner fills the form. `userId` satisfies the RLS WITH CHECK.
export async function createDraftPlan(client: Client, userId: string): Promise<Plan> {
  const draft: PlanInsert = {
    user_id: userId,
    name: "Untitled plan",
    total_distance_km: 0,
    total_elevation_gain_m: 0,
    total_elevation_loss_m: 0,
    start_time: new Date().toISOString(),
    total_expected_minutes: 0,
    hourly_fluid_ml: 0,
    hourly_carb_g: 0,
    hourly_sodium_mg: 0,
  };
  return createPlan(client, draft);
}

export async function updatePlan(client: Client, id: string, patch: PlanUpdate): Promise<Plan> {
  const res = await client.from("plans").update(patch).eq("id", id).select().single();
  if (res.error) throw res.error;
  return res.data;
}

export async function deletePlan(client: Client, id: string): Promise<void> {
  const { error } = await client.from("plans").delete().eq("id", id);
  if (error) throw error;
}

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
  if (error) throw error;
  return data;
}

export async function createPlan(client: Client, input: PlanInsert): Promise<Plan> {
  const res = await client.from("plans").insert(input).select().single();
  if (res.error) throw res.error;
  return res.data;
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

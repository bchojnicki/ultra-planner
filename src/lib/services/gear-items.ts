// Data-access layer for `gear_items` (S-03). Ownership flows through the parent plan:
// the request-scoped Supabase client carries the user's session, and the gear_items RLS
// policies gate on plan_id belonging to a plan the user owns — so app code never filters
// by user_id. Functions throw on Supabase errors so callers handle failure.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, GearItem, GearItemInsert, GearItemUpdate } from "@/types";

type Client = SupabaseClient<Database>;

export async function listGearItems(client: Client, planId: string): Promise<GearItem[]> {
  const { data, error } = await client
    .from("gear_items")
    .select("*")
    .eq("plan_id", planId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createGearItem(client: Client, input: GearItemInsert): Promise<GearItem> {
  const res = await client.from("gear_items").insert(input).select().single();
  if (res.error) throw res.error;
  return res.data;
}

export async function updateGearItem(client: Client, id: string, patch: GearItemUpdate): Promise<GearItem> {
  const res = await client.from("gear_items").update(patch).eq("id", id).select().single();
  if (res.error) throw res.error;
  return res.data;
}

export async function deleteGearItem(client: Client, id: string): Promise<void> {
  const { error } = await client.from("gear_items").delete().eq("id", id);
  if (error) throw error;
}

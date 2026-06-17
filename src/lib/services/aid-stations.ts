// Data-access layer for `aid_stations`. Ownership flows through the parent plan: the
// request-scoped Supabase client carries the user's session, and the aid_stations RLS
// policies gate on plan_id belonging to a plan the user owns — so app code never filters
// by user_id. Functions throw on Supabase errors so callers handle failure.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AidStation, AidStationInsert, AidStationUpdate, Database } from "@/types";

type Client = SupabaseClient<Database>;

export async function listAidStations(client: Client, planId: string): Promise<AidStation[]> {
  const { data, error } = await client
    .from("aid_stations")
    .select("*")
    .eq("plan_id", planId)
    .order("cumulative_distance_km", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createAidStation(client: Client, input: AidStationInsert): Promise<AidStation> {
  const res = await client.from("aid_stations").insert(input).select().single();
  if (res.error) throw res.error;
  return res.data;
}

export async function updateAidStation(client: Client, id: string, patch: AidStationUpdate): Promise<AidStation> {
  const res = await client.from("aid_stations").update(patch).eq("id", id).select().single();
  if (res.error) throw res.error;
  return res.data;
}

export async function deleteAidStation(client: Client, id: string): Promise<void> {
  const { error } = await client.from("aid_stations").delete().eq("id", id);
  if (error) throw error;
}

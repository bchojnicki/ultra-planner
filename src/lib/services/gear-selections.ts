// Data-access layer for `gear_segment_selections` (S-03). Sparse per-stage caps/overrides
// over the gear catalog; ownership flows through the parent plan (plan-subquery RLS), so
// app code never filters by user_id. Functions throw on Supabase errors.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, GearSegmentSelection, GearSegmentSelectionInsert } from "@/types";

type Client = SupabaseClient<Database>;

export async function listGearSelections(client: Client, planId: string): Promise<GearSegmentSelection[]> {
  const { data, error } = await client
    .from("gear_segment_selections")
    .select("*")
    .eq("plan_id", planId)
    .order("segment_index", { ascending: true });
  if (error) throw error;
  return data;
}

// Upsert a per-stage selection keyed by (gear_item_id, segment_index). The sparse-row
// contract: a row exists only while it carries a cap and/or a pin. When both limit_units
// and override_units resolve to null, any existing row is deleted and null is returned,
// so the segment falls back to the live auto-suggestion.
export async function upsertGearSelection(
  client: Client,
  input: GearSegmentSelectionInsert,
): Promise<GearSegmentSelection | null> {
  const limit = input.limit_units ?? null;
  const override = input.override_units ?? null;

  if (limit === null && override === null) {
    const { error } = await client
      .from("gear_segment_selections")
      .delete()
      .eq("gear_item_id", input.gear_item_id)
      .eq("segment_index", input.segment_index);
    if (error) throw error;
    return null;
  }

  const row: GearSegmentSelectionInsert = {
    plan_id: input.plan_id,
    gear_item_id: input.gear_item_id,
    segment_index: input.segment_index,
    limit_units: limit,
    override_units: override,
  };
  const res = await client
    .from("gear_segment_selections")
    .upsert(row, { onConflict: "gear_item_id,segment_index" })
    .select()
    .single();
  if (res.error) throw res.error;
  return res.data;
}

// Reconciliation: drop selections for segment indexes that no longer map after an
// aid-station change (see staleSegmentIndexes in src/lib/gear-allocation.ts). A no-op
// when the list is empty.
export async function deleteSelectionsForSegments(
  client: Client,
  planId: string,
  segmentIndexes: number[],
): Promise<void> {
  if (segmentIndexes.length === 0) return;
  const { error } = await client
    .from("gear_segment_selections")
    .delete()
    .eq("plan_id", planId)
    .in("segment_index", segmentIndexes);
  if (error) throw error;
}

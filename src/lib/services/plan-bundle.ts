// Per-plan page loader (S-04). Composes the plan + its child rows for the
// per-plan pages (read-only view and editor). Returns null when the plan is
// missing/non-owned OR any load fails, so the caller redirects to the dashboard
// rather than surfacing a raw 500. Every query runs under the request-scoped
// client, so RLS scopes the rows to the owner.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AidStation, Database, GearItem, GearSegmentSelection, Plan } from "@/types";
import { getPlan } from "@/lib/services/plans";
import { listAidStations } from "@/lib/services/aid-stations";
import { listGearItems } from "@/lib/services/gear-items";
import { listGearSelections } from "@/lib/services/gear-selections";

type Client = SupabaseClient<Database>;

export interface PlanBundle {
  plan: Plan;
  stations: AidStation[];
  gearItems: GearItem[];
  gearSelections: GearSegmentSelection[];
}

export async function loadPlanBundle(client: Client, id: string): Promise<PlanBundle | null> {
  try {
    const plan = await getPlan(client, id);
    if (!plan) return null;
    // getPlan must run first (its null short-circuits before loading children);
    // the three child loads are independent, so run them concurrently.
    const [stations, gearItems, gearSelections] = await Promise.all([
      listAidStations(client, id),
      listGearItems(client, id),
      listGearSelections(client, id),
    ]);
    return { plan, stations, gearItems, gearSelections };
  } catch {
    return null;
  }
}

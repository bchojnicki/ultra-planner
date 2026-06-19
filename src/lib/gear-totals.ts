import type { GearAllocationResult } from "@/types";

// Sum gear units across all segment allocations into a single { gearItemId → units }
// record — the race-wide total for the plan-table footer. The shape matches what
// `unitsOf` produces for one segment, so the existing `fuelBreakdown` formatter can
// render it directly. Allocations carry final post-limit/override units, so the sum
// reflects the runner's actual selections. Missing items contribute nothing.
export function sumAllocationUnits(allocs: GearAllocationResult[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const alloc of allocs) {
    for (const u of alloc.units) {
      totals[u.gear_item_id] = (totals[u.gear_item_id] ?? 0) + u.units;
    }
  }
  return totals;
}

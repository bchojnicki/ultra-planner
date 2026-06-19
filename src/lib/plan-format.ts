// Plan-specific display formatting shared between the on-screen plan table
// (PlanTable.tsx) and the Excel export builder (plan-export.ts) so the two
// surfaces cannot drift on duration rounding or fuel-string wording. Distance /
// elevation primitives live in format.ts; these are the plan-table-only helpers.
import type { GearItem } from "@/types";

// "5h 03m" — display-only; the calc keeps full-minute float precision.
export function fmtDuration(min: number): string {
  const total = Math.round(min);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

// "1× Tailwind, 2× SIS gel" — every item to carry for the stage, listed once,
// zero-unit items dropped. units maps gear_item_id → unit count.
export function fuelBreakdown(items: GearItem[], units: Record<string, number>): string {
  return items
    .map((it) => ({ it, u: units[it.id] ?? 0 }))
    .filter((x) => x.u > 0)
    .map((x) => `${x.u}× ${x.it.name}`)
    .join(", ");
}

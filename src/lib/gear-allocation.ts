// Gear allocation (S-03) — turns a segment's gram/ml targets into whole-unit
// fueling suggestions per gear item. Pure: no I/O, decorates the S-02 plan-table
// math without touching it (computePlanTable still owns the gram/ml/time numbers).
//
// Carb-led, single deterministic pass:
//   (a) carbs drive the gel/drink/solid_food unit counts — direct overrides are
//       fixed first, then the remaining carb target is split across the rest by
//       carb_ratio, with per-stage unit limits capping a source and redistributing
//       the freed grams across the uncapped sources (iterated until stable);
//   (b) the resulting drink units' fluid counts toward the fluid target, and water
//       carriers fill the remaining gap;
//   (c) the resulting gel/drink/food units' sodium counts toward the sodium target,
//       and salt caps fill the remaining gap.
// Each source rounds to the nearest whole unit; achieved totals and signed deltas
// are reported so the UI can show how close the rounded units land.
import type { GearAllocationResult, GearAllocationUnit, GearItem, GearNutrients, GearSegmentSelection } from "@/types";

export interface GearAllocationInput {
  carbTarget: number;
  fluidTarget: number;
  sodiumTarget: number;
  items: GearItem[];
  // Selections for THIS segment only (caller filters by segment_index).
  selections: GearSegmentSelection[];
}

// Floating-point slop guard for "share exceeds cap" / "anything left" comparisons.
const EPS = 1e-9;

// Per-unit fluid an item contributes: a drink pours its serving, a water carrier its
// capacity; everything else contributes no fluid.
function fluidPerUnit(item: GearItem): number {
  if (item.kind === "drink") return item.fluid_ml ?? 0;
  if (item.kind === "water_carrier") return item.capacity_ml ?? 0;
  return 0;
}

export function computeGearAllocation(input: GearAllocationInput): GearAllocationResult {
  const { carbTarget, fluidTarget, sodiumTarget, items, selections } = input;

  const units = new Map<string, number>();
  for (const it of items) units.set(it.id, 0);

  const selectionFor = (id: string): GearSegmentSelection | null =>
    selections.find((s) => s.gear_item_id === id) ?? null;

  // ---- (a) carbs: overrides fixed, then ratio split with limit redistribution ----
  const carbItems = items.filter(
    (i) => (i.kind === "gel" || i.kind === "drink" || i.kind === "solid_food") && (i.carb_g ?? 0) > EPS,
  );

  let remainingCarb = carbTarget;
  const ratioItems: GearItem[] = [];
  for (const it of carbItems) {
    const s = selectionFor(it.id);
    if (s && s.override_units !== null) {
      units.set(it.id, s.override_units);
      remainingCarb -= s.override_units * (it.carb_g ?? 0);
    } else {
      ratioItems.push(it);
    }
  }
  remainingCarb = Math.max(0, remainingCarb);

  // cap in grams per ratio source (Infinity = no limit); a zero ratio means
  // "don't auto-suggest from me" → cap at 0 grams so it never receives a share.
  const capGrams = new Map<string, number>();
  let active: GearItem[] = [];
  const fixedGrams = new Map<string, number>(); // capped/zeroed sources → grams allotted
  for (const it of ratioItems) {
    const s = selectionFor(it.id);
    if (it.carb_ratio <= EPS) {
      fixedGrams.set(it.id, 0);
      units.set(it.id, 0);
      continue;
    }
    capGrams.set(it.id, s && s.limit_units !== null ? s.limit_units * (it.carb_g ?? 0) : Infinity);
    active.push(it);
  }

  // Iterate: allocate the remaining (target − fixed) across active sources by ratio;
  // any source whose share exceeds its cap is pinned at the cap and removed, freeing
  // grams for the rest. Converges in ≤ active.length passes (active shrinks each loop).
  for (;;) {
    const fixedTotal = [...fixedGrams.values()].reduce((a, b) => a + b, 0);
    const remaining = Math.max(0, remainingCarb - fixedTotal);
    const totalRatio = active.reduce((a, it) => a + it.carb_ratio, 0);

    if (active.length === 0 || totalRatio <= EPS || remaining <= EPS) {
      for (const it of active) {
        const grams = totalRatio > EPS ? remaining * (it.carb_ratio / totalRatio) : 0;
        units.set(it.id, Math.round(grams / (it.carb_g ?? 1)));
      }
      break;
    }

    const exceeders = active.filter((it) => {
      const grams = remaining * (it.carb_ratio / totalRatio);
      return grams > (capGrams.get(it.id) ?? Infinity) + EPS;
    });

    if (exceeders.length === 0) {
      for (const it of active) {
        const grams = remaining * (it.carb_ratio / totalRatio);
        units.set(it.id, Math.round(grams / (it.carb_g ?? 1)));
      }
      break;
    }

    for (const it of exceeders) {
      const cap = capGrams.get(it.id) ?? Infinity;
      fixedGrams.set(it.id, cap);
      units.set(it.id, Math.round(cap / (it.carb_g ?? 1)));
    }
    active = active.filter((it) => !exceeders.includes(it));
  }

  // ---- (b) fluid: drinks already counted; water carriers fill the gap ----
  let drinkFluid = 0;
  for (const it of items) {
    if (it.kind === "drink") drinkFluid += (units.get(it.id) ?? 0) * (it.fluid_ml ?? 0);
  }
  let remainingFluid = Math.max(0, fluidTarget - drinkFluid);
  for (const it of items) {
    if (it.kind !== "water_carrier") continue;
    const per = it.capacity_ml ?? 0;
    if (per <= EPS) continue;
    const s = selectionFor(it.id);
    let u: number;
    if (s && s.override_units !== null) {
      u = s.override_units;
    } else {
      u = Math.round(remainingFluid / per);
      if (s && s.limit_units !== null) u = Math.min(u, s.limit_units);
    }
    units.set(it.id, u);
    remainingFluid = Math.max(0, remainingFluid - u * per);
  }

  // ---- (c) sodium: carb-source sodium already counted; salt caps fill the gap ----
  let baseSodium = 0;
  for (const it of items) {
    if (it.kind !== "salt_cap") baseSodium += (units.get(it.id) ?? 0) * (it.sodium_mg ?? 0);
  }
  let remainingSodium = Math.max(0, sodiumTarget - baseSodium);
  for (const it of items) {
    if (it.kind !== "salt_cap") continue;
    const per = it.sodium_mg ?? 0;
    if (per <= EPS) continue;
    const s = selectionFor(it.id);
    let u: number;
    if (s && s.override_units !== null) {
      u = s.override_units;
    } else {
      u = Math.round(remainingSodium / per);
      if (s && s.limit_units !== null) u = Math.min(u, s.limit_units);
    }
    units.set(it.id, u);
    remainingSodium = Math.max(0, remainingSodium - u * per);
  }

  // ---- (d) achieved totals + signed deltas ----
  const achieved: GearNutrients = { carb_g: 0, fluid_ml: 0, sodium_mg: 0 };
  const unitList: GearAllocationUnit[] = items.map((it) => {
    const u = units.get(it.id) ?? 0;
    achieved.carb_g += u * (it.carb_g ?? 0);
    achieved.fluid_ml += u * fluidPerUnit(it);
    achieved.sodium_mg += u * (it.sodium_mg ?? 0);
    return { gear_item_id: it.id, units: u };
  });

  const delta: GearNutrients = {
    carb_g: achieved.carb_g - carbTarget,
    fluid_ml: achieved.fluid_ml - fluidTarget,
    sodium_mg: achieved.sodium_mg - sodiumTarget,
  };

  return { units: unitList, achieved, delta };
}

// Reconciliation helper: after an aid-station add/delete changes the segment count,
// stored selections whose segment_index no longer maps to a real leg must be dropped
// so a quantity is never mis-attributed. Positional rule: an index >= the new count
// is out of range. Growth never pushes an existing index out of range; an unchanged
// count needs no reconciliation. Returns a sorted, de-duplicated index list.
export function staleSegmentIndexes(
  prevSegmentCount: number,
  nextSegmentCount: number,
  existing: GearSegmentSelection[],
): number[] {
  if (prevSegmentCount === nextSegmentCount) return [];
  const stale = new Set<number>();
  for (const s of existing) {
    if (s.segment_index >= nextSegmentCount) stale.add(s.segment_index);
  }
  return [...stale].sort((a, b) => a - b);
}

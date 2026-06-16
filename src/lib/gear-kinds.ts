import type { GearKind } from "@/types";

// Gear-kind display metadata, shared by the editor (GearProfileForm) and the
// read-only view (GearList). Mirrors the aid-station-facilities.ts pattern so the
// labels and per-kind field sets have a single source of truth.

// The fueling field each kind exposes. carb_ratio only matters for carb sources
// (it weights the auto-suggestion split); a water carrier holds capacity, a salt cap sodium.
export type GearFieldKey = "carb_g" | "sodium_mg" | "fluid_ml" | "capacity_ml" | "carb_ratio";

export const GEAR_FIELD_LABELS: Record<GearFieldKey, string> = {
  carb_g: "Carbs / unit (g)",
  sodium_mg: "Sodium / unit (mg)",
  fluid_ml: "Fluid / serving (ml)",
  capacity_ml: "Capacity / unit (ml)",
  carb_ratio: "Carb ratio",
};

export const GEAR_KIND_FIELDS: Record<GearKind, GearFieldKey[]> = {
  gel: ["carb_g", "sodium_mg", "carb_ratio"],
  drink: ["carb_g", "fluid_ml", "sodium_mg", "carb_ratio"],
  solid_food: ["carb_g", "sodium_mg", "carb_ratio"],
  water_carrier: ["capacity_ml"],
  salt_cap: ["sodium_mg"],
};

export const GEAR_KIND_LABELS: Record<GearKind, string> = {
  gel: "Gel",
  drink: "Carb drink",
  solid_food: "Solid food",
  water_carrier: "Water carrier",
  salt_cap: "Salt cap",
};

export const GEAR_KIND_ORDER: GearKind[] = ["gel", "drink", "solid_food", "water_carrier", "salt_cap"];

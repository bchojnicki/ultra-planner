// Golden-number tests for the gear allocation transform (S-03, Phase 3).
// Expectations are hand-derived from the carb-led allocation rules, independent of
// the implementation, so a regression in the unit math fails loudly. Pure — no DB.
import { describe, expect, it } from "vitest";
import type { GearItem, GearSegmentSelection } from "../../src/types";
import { computeGearAllocation, staleSegmentIndexes } from "../../src/lib/gear-allocation";

const TS = "2026-09-01T06:00:00.000Z";

function item(over: Partial<GearItem> & Pick<GearItem, "id" | "kind">): GearItem {
  return {
    plan_id: "plan-1",
    name: over.kind,
    carb_g: null,
    sodium_mg: null,
    fluid_ml: null,
    capacity_ml: null,
    carb_ratio: 1,
    created_at: TS,
    updated_at: TS,
    ...over,
  };
}

function sel(over: Partial<GearSegmentSelection> & Pick<GearSegmentSelection, "gear_item_id">): GearSegmentSelection {
  return {
    id: `sel-${over.gear_item_id}-${over.segment_index ?? 0}`,
    plan_id: "plan-1",
    segment_index: 0,
    limit_units: null,
    override_units: null,
    created_at: TS,
    updated_at: TS,
    ...over,
  };
}

// Reused catalog: drink 80g carbs (500ml) ratio 1, gel 20g ratio 2, solid 50g ratio 1.
const drink = item({ id: "drink", kind: "drink", carb_g: 80, fluid_ml: 500, carb_ratio: 1 });
const gel = item({ id: "gel", kind: "gel", carb_g: 20, carb_ratio: 2 });
const solid = item({ id: "solid", kind: "solid_food", carb_g: 50, carb_ratio: 1 });

function unitsById(result: { units: { gear_item_id: string; units: number }[] }): Record<string, number> {
  return Object.fromEntries(result.units.map((u) => [u.gear_item_id, u.units]));
}

describe("computeGearAllocation — carbs by ratio (no limits)", () => {
  // Target 400 g, ratio 1:2:1 → drink 100 g, gel 200 g, solid 100 g.
  // Units round per source: drink round(100/80)=1, gel 200/20=10, solid 100/50=2.
  const result = computeGearAllocation({
    carbTarget: 400,
    fluidTarget: 0,
    sodiumTarget: 0,
    items: [drink, gel, solid],
    selections: [],
  });

  it("splits proportionally and rounds each source", () => {
    const u = unitsById(result);
    expect(u.drink).toBe(1);
    expect(u.gel).toBe(10);
    expect(u.solid).toBe(2);
  });

  it("reports achieved carbs and a negative delta from drink rounding down", () => {
    // 1·80 + 10·20 + 2·50 = 380 → delta −20.
    expect(result.achieved.carb_g).toBe(380);
    expect(result.delta.carb_g).toBe(-20);
  });
});

describe("computeGearAllocation — limit cap + redistribution cascade", () => {
  // Worked example: cap the drink at 1 unit (80 g). Remaining 320 g splits gel:solid 2:1
  // → gel 213.3 g → round(10.67)=11, solid 106.7 g → round(2.13)=2.
  const result = computeGearAllocation({
    carbTarget: 400,
    fluidTarget: 0,
    sodiumTarget: 0,
    items: [drink, gel, solid],
    selections: [sel({ gear_item_id: "drink", limit_units: 1 })],
  });

  it("caps the limited source and redistributes the remainder by ratio", () => {
    const u = unitsById(result);
    expect(u.drink).toBe(1);
    expect(u.gel).toBe(11);
    expect(u.solid).toBe(2);
  });

  it("lands exactly on target after redistribution", () => {
    // 1·80 + 11·20 + 2·50 = 400 → delta 0.
    expect(result.achieved.carb_g).toBe(400);
    expect(result.delta.carb_g).toBe(0);
  });
});

describe("computeGearAllocation — direct override wins", () => {
  // Override drink = 2 (160 g). Remaining 240 g splits gel:solid 2:1
  // → gel 160 g = 8, solid 80 g → round(1.6)=2.
  const result = computeGearAllocation({
    carbTarget: 400,
    fluidTarget: 0,
    sodiumTarget: 0,
    items: [drink, gel, solid],
    selections: [sel({ gear_item_id: "drink", override_units: 2 })],
  });

  it("pins the overridden source and fills the rest from the remaining target", () => {
    const u = unitsById(result);
    expect(u.drink).toBe(2);
    expect(u.gel).toBe(8);
    expect(u.solid).toBe(2);
  });

  it("reports a positive delta when units exceed the target", () => {
    // 2·80 + 8·20 + 2·50 = 420 → delta +20.
    expect(result.achieved.carb_g).toBe(420);
    expect(result.delta.carb_g).toBe(20);
  });
});

describe("computeGearAllocation — fluid gap-fill via water carrier", () => {
  // 1 drink (carb target 80 g) gives 500 ml; carrier (500 ml) fills the 1500 ml gap → 3 units.
  const carrier = item({ id: "carrier", kind: "water_carrier", capacity_ml: 500 });
  const result = computeGearAllocation({
    carbTarget: 80,
    fluidTarget: 2000,
    sodiumTarget: 0,
    items: [drink, carrier],
    selections: [],
  });

  it("counts drink fluid then fills the remainder with carrier units", () => {
    const u = unitsById(result);
    expect(u.drink).toBe(1);
    expect(u.carrier).toBe(3);
  });

  it("achieves the fluid target exactly", () => {
    expect(result.achieved.fluid_ml).toBe(2000);
    expect(result.delta.fluid_ml).toBe(0);
  });
});

describe("computeGearAllocation — sodium gap-fill via salt caps", () => {
  // gel: 20 g carbs + 50 mg sodium. Carb target 100 g → 5 gels → 250 mg sodium.
  // Sodium target 1000 mg → remaining 750 mg, salt cap 200 mg → round(3.75)=4 → 800 mg.
  const gelNa = item({ id: "gelNa", kind: "gel", carb_g: 20, sodium_mg: 50, carb_ratio: 1 });
  const salt = item({ id: "salt", kind: "salt_cap", sodium_mg: 200 });
  const result = computeGearAllocation({
    carbTarget: 100,
    fluidTarget: 0,
    sodiumTarget: 1000,
    items: [gelNa, salt],
    selections: [],
  });

  it("counts carb-source sodium then fills the remainder with salt caps", () => {
    const u = unitsById(result);
    expect(u.gelNa).toBe(5);
    expect(u.salt).toBe(4);
  });

  it("reports achieved sodium and a positive delta", () => {
    // 5·50 + 4·200 = 1050 → delta +50.
    expect(result.achieved.sodium_mg).toBe(1050);
    expect(result.delta.sodium_mg).toBe(50);
  });
});

describe("computeGearAllocation — edge cases", () => {
  it("zero gear → no units, zero achieved, delta = −target", () => {
    const result = computeGearAllocation({
      carbTarget: 300,
      fluidTarget: 1000,
      sodiumTarget: 700,
      items: [],
      selections: [],
    });
    expect(result.units).toHaveLength(0);
    expect(result.achieved).toEqual({ carb_g: 0, fluid_ml: 0, sodium_mg: 0 });
    expect(result.delta).toEqual({ carb_g: -300, fluid_ml: -1000, sodium_mg: -700 });
  });

  it("a zero carb_ratio source is never auto-suggested (0 units)", () => {
    const muted = item({ id: "muted", kind: "gel", carb_g: 20, carb_ratio: 0 });
    const result = computeGearAllocation({
      carbTarget: 100,
      fluidTarget: 0,
      sodiumTarget: 0,
      items: [muted, gel],
      selections: [],
    });
    const u = unitsById(result);
    expect(u.muted).toBe(0);
    expect(u.gel).toBe(5); // gel (ratio 2) absorbs the whole 100 g → 5 units
  });

  it("a per-stage override of 0 forces a source off even when it would be suggested", () => {
    const result = computeGearAllocation({
      carbTarget: 100,
      fluidTarget: 0,
      sodiumTarget: 0,
      items: [gel],
      selections: [sel({ gear_item_id: "gel", override_units: 0 })],
    });
    expect(unitsById(result).gel).toBe(0);
  });
});

describe("staleSegmentIndexes", () => {
  const existing = [
    sel({ gear_item_id: "a", segment_index: 0 }),
    sel({ gear_item_id: "b", segment_index: 1 }),
    sel({ gear_item_id: "c", segment_index: 2 }),
    sel({ gear_item_id: "d", segment_index: 2 }), // duplicate index, different item
  ];

  it("returns indexes beyond the new range when segments shrink", () => {
    expect(staleSegmentIndexes(3, 2, existing)).toEqual([2]);
  });

  it("clears multiple out-of-range indexes, de-duplicated and sorted", () => {
    expect(staleSegmentIndexes(3, 1, existing)).toEqual([1, 2]);
  });

  it("returns nothing when the count is unchanged", () => {
    expect(staleSegmentIndexes(3, 3, existing)).toEqual([]);
  });

  it("returns nothing on growth (no existing index falls out of range)", () => {
    expect(staleSegmentIndexes(3, 5, existing)).toEqual([]);
  });
});

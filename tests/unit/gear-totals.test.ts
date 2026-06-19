// Unit tests for the race-wide gear summation (gear-total-summary).
// Pure — no DB, no React. Locks the cross-segment sum independent of the component.
import { describe, expect, it } from "vitest";
import type { GearAllocationResult, GearNutrients } from "../../src/types";
import { sumAllocationUnits } from "../../src/lib/gear-totals";

const ZERO: GearNutrients = { carb_g: 0, fluid_ml: 0, sodium_mg: 0 };

function alloc(units: Record<string, number>): GearAllocationResult {
  return {
    units: Object.entries(units).map(([gear_item_id, u]) => ({ gear_item_id, units: u })),
    achieved: ZERO,
    delta: ZERO,
  };
}

describe("sumAllocationUnits", () => {
  it("sums one item across multiple segments", () => {
    const totals = sumAllocationUnits([alloc({ gel: 3 }), alloc({ gel: 2 }), alloc({ gel: 4 })]);
    expect(totals).toEqual({ gel: 9 });
  });

  it("sums multiple distinct items, accumulating each independently", () => {
    const totals = sumAllocationUnits([
      alloc({ gel: 2, drink: 1 }),
      alloc({ gel: 3, drink: 1 }),
      alloc({ gel: 0, drink: 2 }),
    ]);
    expect(totals).toEqual({ gel: 5, drink: 4 });
  });

  it("keeps an all-zero item at zero (renders as absent via fuelBreakdown)", () => {
    const totals = sumAllocationUnits([alloc({ gel: 0 }), alloc({ gel: 0 })]);
    expect(totals).toEqual({ gel: 0 });
  });

  it("returns an empty record for no allocations", () => {
    expect(sumAllocationUnits([])).toEqual({});
  });

  it("treats an item missing from one segment as contributing nothing there", () => {
    // Defensive: real allocations carry one entry per item, but a sparse input
    // must still accumulate the entries it does have.
    const totals = sumAllocationUnits([alloc({ gel: 2 }), alloc({ drink: 1 })]);
    expect(totals).toEqual({ gel: 2, drink: 1 });
  });
});

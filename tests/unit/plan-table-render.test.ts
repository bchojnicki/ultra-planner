// Render tests for the plan-table footer gear total (gear-total-summary).
// Uses react-dom/server static rendering in the node env (no jsdom / RTL needed,
// no new deps). Closes the manual-only criteria 1.5/1.7/1.8 with automated evidence:
// the total cell sums across segments, stays blank when zero, and renders in the
// read-only view.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlanTable from "../../src/components/plans/PlanTable";
import type { GearAllocationResult, GearItem, GearNutrients, PlanTableResult } from "../../src/types";

const ISO = "2026-09-01T06:00:00.000Z";
const ZERO: GearNutrients = { carb_g: 0, fluid_ml: 0, sodium_mg: 0 };

function row(label: string) {
  return {
    label,
    segment_distance_km: 50,
    segment_elevation_gain_m: 1000,
    segment_elevation_loss_m: 1000,
    moving_minutes: 300,
    arrival: ISO,
    fluid_ml: 2000,
    carb_g: 240,
    sodium_mg: 2800,
    endStation: null,
  };
}

function result(): PlanTableResult {
  return {
    ok: true,
    rows: [row("Start → AS1"), row("AS1 → Finish")],
    totals: {
      distance_km: 100,
      elevation_gain_m: 2000,
      elevation_loss_m: 2000,
      moving_minutes: 600,
      rest_minutes: 0,
      fluid_ml: 4000,
      carb_g: 480,
      sodium_mg: 5600,
      finish_arrival: ISO,
    },
  };
}

function gear(id: string, name: string): GearItem {
  return {
    id,
    plan_id: "plan-1",
    kind: "gel",
    name,
    carb_g: 20,
    sodium_mg: null,
    fluid_ml: null,
    capacity_ml: null,
    carb_ratio: 1,
    created_at: ISO,
    updated_at: ISO,
  };
}

function alloc(units: Record<string, number>): GearAllocationResult {
  return {
    units: Object.entries(units).map(([gear_item_id, u]) => ({ gear_item_id, units: u })),
    achieved: ZERO,
    delta: ZERO,
  };
}

const items = [gear("g1", "SIS gel"), gear("g2", "Tailwind")];

// Pull the text content of the footer total cell out of the static markup.
function totalCell(html: string): string {
  const m = /data-testid="fuel-total-cell"[^>]*>([^<]*)</.exec(html);
  return m?.[1] ?? "__MISSING__";
}

describe("PlanTable footer gear total", () => {
  it("sums each item's units across all segments", () => {
    const html = renderToStaticMarkup(
      createElement(PlanTable, {
        result: result(),
        items,
        allocations: [alloc({ g1: 3, g2: 1 }), alloc({ g1: 2, g2: 1 })],
        onSelectionChange: () => undefined,
      }),
    );
    expect(totalCell(html)).toBe("5× SIS gel, 2× Tailwind");
  });

  it("renders a blank cell when every item totals zero (no — fallback)", () => {
    const html = renderToStaticMarkup(
      createElement(PlanTable, {
        result: result(),
        items,
        allocations: [alloc({ g1: 0, g2: 0 }), alloc({ g1: 0, g2: 0 })],
        onSelectionChange: () => undefined,
      }),
    );
    expect(totalCell(html)).toBe("");
  });

  it("renders the total in the read-only view and suppresses the gear toggle", () => {
    const html = renderToStaticMarkup(
      createElement(PlanTable, {
        result: result(),
        items,
        allocations: [alloc({ g1: 3, g2: 1 }), alloc({ g1: 2, g2: 1 })],
        readOnly: true,
      }),
    );
    expect(totalCell(html)).toBe("5× SIS gel, 2× Tailwind");
    expect(html).not.toContain('data-testid="gear-toggle"');
  });
});

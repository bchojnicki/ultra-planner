// Plan → Excel workbook builder (excel-export, Phase 1). Pure: data-in → bytes-out,
// no DOM and no download side-effects, so it is unit-testable and the heavy SheetJS
// dependency stays lazy-loadable from the React layer. Generation runs entirely in
// the browser (mirrors the GpxImport precedent — nothing touches the Workers runtime).
//
// SheetJS is used WRITE-ONLY (utils + write); the read path — the source of the
// known prototype-pollution advisory — is never imported.
import * as XLSX from "xlsx";
import type { AidStation, GearAllocationResult, GearItem, Plan, PlanTableResult } from "@/types";
import { enabledFacilities } from "@/lib/aid-station-facilities";
import { fmtKm, fmtM } from "@/lib/format";
import { fmtDuration, fuelBreakdown } from "@/lib/plan-format";

export interface PlanExportInput {
  plan: Plan;
  result: PlanTableResult;
  items: GearItem[];
  allocations: GearAllocationResult[];
}

// One worksheet cell value. Strings (labels, clock times, fuel) and numbers
// (distance, elevation, nutrients) share the grid; SheetJS infers the cell type.
type Cell = string | number;

// Numeric cells round to match the on-screen display exactly (fmtKm → 0.1 km,
// fmtM → whole m) but stay numbers so Excel can sum/sort them — never the
// formatted strings, which Excel would treat as text.
const numKm = (km: number): number => Number(fmtKm(km));
const numM = (m: number): number => Number(fmtM(m));

// Local clock arrival, matching what a mounted PlanTable viewer sees (the table
// flips UTC→local after hydration). This is the one table column that is a string.
function fmtClockLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtStart(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function unitsOf(alloc: GearAllocationResult): Record<string, number> {
  return Object.fromEntries(alloc.units.map((u) => [u.gear_item_id, u.units]));
}

// Aid-station characteristics: enabled facilities + rest minutes (free-text notes
// go in their own column). The finish row (no station) reads "Finish".
function stationFacilitiesCell(station: AidStation | null): string {
  if (!station) return "Finish";
  const parts = [...enabledFacilities(station)];
  if (station.time_spent_min > 0) parts.push(`Rest ${station.time_spent_min} min`);
  return parts.join(" · ");
}

// Race-parameters key/value block — mirrors the fields in PlanSummary.astro.
function paramRows(plan: Plan): Cell[][] {
  return [
    ["Plan", plan.name],
    ["Total distance (km)", numKm(plan.total_distance_km)],
    ["Elevation gain (m)", numM(plan.total_elevation_gain_m)],
    ["Elevation loss (m)", numM(plan.total_elevation_loss_m)],
    ["Start time", fmtStart(plan.start_time)],
    ["Expected finish", fmtDuration(plan.total_expected_minutes)],
    ["Hourly fluid (ml)", plan.hourly_fluid_ml],
    ["Hourly carbs (g)", plan.hourly_carb_g],
    ["Hourly sodium (mg)", plan.hourly_sodium_mg],
  ];
}

// Build the single-sheet workbook bytes as an ArrayBuffer (the shape the browser
// wraps directly in a Blob for download). Caller guarantees result.ok === true;
// when it is not (missing params) the export button is hidden, but we still return
// a params-only workbook rather than throw so the builder never crashes the UI.
export function buildPlanWorkbook(input: PlanExportInput): ArrayBuffer {
  const { plan, result, items, allocations } = input;
  const gearActive = items.length > 0 && result.ok && allocations.length === result.rows.length;

  const aoa: Cell[][] = [...paramRows(plan), []];

  const header: Cell[] = ["Segment", "Dist (km)", "Gain (m)", "Loss (m)", "Time", "Arrival"];
  header.push("Fluid (ml)", "Carbs (g)", "Sodium (mg)");
  if (gearActive) header.push("Fuel");
  header.push("Aid station", "Notes");
  aoa.push(header);

  if (result.ok) {
    result.rows.forEach((r, idx) => {
      const row: Cell[] = [
        r.label,
        numKm(r.segment_distance_km),
        numM(r.segment_elevation_gain_m),
        numM(r.segment_elevation_loss_m),
        fmtDuration(r.moving_minutes),
        fmtClockLocal(r.arrival),
        Math.round(r.fluid_ml),
        Math.round(r.carb_g),
        Math.round(r.sodium_mg),
      ];
      if (gearActive) row.push(fuelBreakdown(items, unitsOf(allocations[idx])));
      row.push(stationFacilitiesCell(r.endStation), r.endStation?.notes ?? "");
      aoa.push(row);
    });

    const { totals } = result;
    const totalRow: Cell[] = [
      "Total",
      numKm(totals.distance_km),
      numM(totals.elevation_gain_m),
      numM(totals.elevation_loss_m),
      fmtDuration(totals.moving_minutes),
      fmtClockLocal(totals.finish_arrival),
      Math.round(totals.fluid_ml),
      Math.round(totals.carb_g),
      Math.round(totals.sodium_mg),
    ];
    if (gearActive) {
      const raceTotals: Record<string, number> = {};
      for (const alloc of allocations) {
        for (const u of alloc.units) raceTotals[u.gear_item_id] = (raceTotals[u.gear_item_id] ?? 0) + u.units;
      }
      totalRow.push(fuelBreakdown(items, raceTotals));
    }
    totalRow.push(totals.rest_minutes > 0 ? `Rest ${totals.rest_minutes} min` : "", "");
    aoa.push(totalRow);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Plan");
  // type: "array" → ArrayBuffer, the shape the browser wraps in a Blob for download.
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

// "<sanitized plan name>.xlsx" — strips characters illegal in filenames and
// collapses whitespace so the download lands with a sensible, safe name.
export function planExportFilename(plan: Plan): string {
  const base =
    plan.name
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "plan";
  return `${base}.xlsx`;
}

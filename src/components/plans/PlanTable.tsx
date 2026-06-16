import { useState } from "react";
import type { GearAllocationResult, GearItem, GearSegmentSelection, PlanTableResult } from "@/types";
import type { SaveStatus } from "@/components/hooks/useAutosave";
import { enabledFacilities } from "@/lib/aid-station-facilities";

const SELECTION_STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — will retry on next change",
};

// Per-segment limit/override patch the panel emits upward. Sending both fields keeps
// the upsert sparse: { null, null } clears the selection back to the live suggestion.
export interface SelectionPatch {
  limit_units: number | null;
  override_units: number | null;
}

// Display-only rounding — the calc keeps full float precision (accuracy guardrail).
function fmtDuration(min: number): string {
  const total = Math.round(min);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function unitsOf(alloc: GearAllocationResult): Record<string, number> {
  return Object.fromEntries(alloc.units.map((u) => [u.gear_item_id, u.units]));
}

// "1× Tailwind, 2× SIS gel" — every item to carry for the stage, listed once
// (a drink contributes to both fluid and carbs, but appears here a single time).
function fuelBreakdown(items: GearItem[], units: Record<string, number>): string {
  return items
    .map((it) => ({ it, u: units[it.id] ?? 0 }))
    .filter((x) => x.u > 0)
    .map((x) => `${x.u}× ${x.it.name}`)
    .join(", ");
}

function parseUnit(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

interface Props {
  result: PlanTableResult;
  // When items is non-empty, the nutrient cells switch to unit-level output and each
  // row gains an expandable per-source limit/override panel. allocations is parallel
  // to result.rows (index = segment_index). All four are wired together in Phase 5.
  items?: GearItem[];
  allocations?: GearAllocationResult[];
  selections?: GearSegmentSelection[];
  onSelectionChange?: (segmentIndex: number, gearItemId: string, patch: SelectionPatch) => void;
  // Passive save indicator for per-segment limit/override writes.
  selectionStatus?: SaveStatus;
}

// A signed-delta secondary line: "392/400 g (−8)". Under-target is amber, on/over is muted.
function NutrientSecondary({ achieved, target, unit }: { achieved: number; target: number; unit: string }) {
  const d = Math.round(achieved - target);
  const sign = d > 0 ? "+" : "";
  return (
    <div className={`text-xs ${d < 0 ? "text-amber-300/80" : "text-blue-100/50"}`}>
      {Math.round(achieved)}/{Math.round(target)} {unit} ({sign}
      {d})
    </div>
  );
}

// Expanded controls for one segment: suggested units + a cap and an exact override per source.
function GearPanel({
  segmentIndex,
  items,
  units,
  selections,
  onSelectionChange,
}: {
  segmentIndex: number;
  items: GearItem[];
  units: Record<string, number>;
  selections: GearSegmentSelection[];
  onSelectionChange: (segmentIndex: number, gearItemId: string, patch: SelectionPatch) => void;
}) {
  const cellCls =
    "w-20 rounded border border-white/20 bg-white/10 px-2 py-1 text-white focus:ring-2 focus:ring-purple-400 focus:outline-none";
  return (
    <div data-testid="gear-panel" className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      {items.map((it) => {
        const cur = selections.find((s) => s.gear_item_id === it.id) ?? null;
        const limitVal = cur?.limit_units ?? null;
        const overrideVal = cur?.override_units ?? null;
        return (
          <div key={it.id} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="min-w-32 font-medium">{it.name}</span>
            <span data-testid="gear-suggested" className="text-blue-100/60">
              suggested {units[it.id] ?? 0}
            </span>
            <label className="flex items-center gap-1 text-blue-100/70">
              Limit
              <input
                type="number"
                min="0"
                step="1"
                aria-label={`Limit ${it.name} on segment ${segmentIndex + 1}`}
                className={cellCls}
                value={limitVal === null ? "" : String(limitVal)}
                onChange={(e) => {
                  onSelectionChange(segmentIndex, it.id, {
                    limit_units: parseUnit(e.target.value),
                    override_units: overrideVal,
                  });
                }}
              />
            </label>
            <label className="flex items-center gap-1 text-blue-100/70">
              Override
              <input
                type="number"
                min="0"
                step="1"
                aria-label={`Override ${it.name} on segment ${segmentIndex + 1}`}
                className={cellCls}
                value={overrideVal === null ? "" : String(overrideVal)}
                onChange={(e) => {
                  onSelectionChange(segmentIndex, it.id, {
                    limit_units: limitVal,
                    override_units: parseUnit(e.target.value),
                  });
                }}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}

export default function PlanTable({
  result,
  items,
  allocations,
  selections,
  onSelectionChange,
  selectionStatus = "idle",
}: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (!result.ok) {
    return (
      <section
        data-testid="plan-table-error"
        className="mt-6 rounded-2xl border border-amber-300/30 bg-amber-200/10 p-6 text-sm text-amber-100"
      >
        {result.message}
      </section>
    );
  }

  const { rows, totals } = result;
  // Concrete, always-defined locals so indexing/guards stay simple below.
  const gearItems = items ?? [];
  const allocs = allocations ?? [];
  const sels = selections ?? [];
  const gearActive = gearItems.length > 0 && allocs.length === rows.length;
  // Column count: 8 base + Aid station, plus the Fuel column when gear is active.
  const colCount = gearActive ? 10 : 9;

  function toggle(idx: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Plan table</h2>
        {gearActive ? (
          <span data-testid="gear-save-status" className="text-xs text-blue-100/60" aria-live="polite">
            {SELECTION_STATUS_TEXT[selectionStatus]}
          </span>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table data-testid="plan-table" className="w-full border-collapse text-left text-sm">
          <thead className="text-blue-100/60">
            <tr>
              <th className="py-2 pr-4">Segment</th>
              <th className="py-2 pr-4">Dist</th>
              <th className="py-2 pr-4">Gain</th>
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Arrival</th>
              <th className="py-2 pr-4">Fluid</th>
              <th className="py-2 pr-4">Carbs</th>
              <th className="py-2 pr-4">Sodium</th>
              {gearActive ? <th className="py-2 pr-4">Fuel</th> : null}
              <th className="py-2">Aid station</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const station = r.endStation;
              const alloc = gearActive ? allocs[idx] : null;
              const units = alloc ? unitsOf(alloc) : {};
              return (
                <tr key={r.label} data-testid="plan-row" className="border-t border-white/10 align-top">
                  <td className="py-2 pr-4 font-medium whitespace-nowrap">
                    {r.label}
                    {gearActive ? (
                      <button
                        type="button"
                        data-testid="gear-toggle"
                        aria-expanded={expanded.has(idx)}
                        onClick={() => {
                          toggle(idx);
                        }}
                        className="mt-1 block rounded-md border border-white/20 px-2 py-0.5 text-xs text-blue-100/70 transition-colors hover:bg-white/10"
                      >
                        {expanded.has(idx) ? "▾ gear" : "▸ gear"}
                      </button>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{r.segment_distance_km} km</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{r.segment_elevation_gain_m} m</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{fmtDuration(r.moving_minutes)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{fmtClock(r.arrival)}</td>
                  {alloc ? (
                    <>
                      <td data-testid="fluid-cell" className="py-2 pr-4 whitespace-nowrap">
                        <NutrientSecondary achieved={alloc.achieved.fluid_ml} target={r.fluid_ml} unit="ml" />
                      </td>
                      <td data-testid="carbs-cell" className="py-2 pr-4 whitespace-nowrap">
                        <NutrientSecondary achieved={alloc.achieved.carb_g} target={r.carb_g} unit="g" />
                      </td>
                      <td data-testid="sodium-cell" className="py-2 pr-4 whitespace-nowrap">
                        <NutrientSecondary achieved={alloc.achieved.sodium_mg} target={r.sodium_mg} unit="mg" />
                      </td>
                      <td data-testid="fuel-cell" className="py-2 pr-4 whitespace-normal">
                        {fuelBreakdown(gearItems, units) || "—"}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-4 whitespace-nowrap">{Math.round(r.fluid_ml)} ml</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{Math.round(r.carb_g)} g</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{Math.round(r.sodium_mg)} mg</td>
                    </>
                  )}
                  <td className="py-2 whitespace-normal">
                    {station ? (
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-1">
                          {enabledFacilities(station).map((label) => (
                            <span key={label} className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-blue-100/70">
                              {label}
                            </span>
                          ))}
                        </div>
                        {station.time_spent_min > 0 ? (
                          <div className="text-xs text-blue-100/50">Rest {station.time_spent_min} min</div>
                        ) : null}
                        {station.notes ? <div className="text-xs text-blue-100/40">{station.notes}</div> : null}
                      </div>
                    ) : (
                      <span className="text-blue-100/40">Finish</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {gearActive && onSelectionChange
              ? rows.map((r, idx) =>
                  expanded.has(idx) ? (
                    <tr key={`${r.label}-panel`} className="border-t border-white/5">
                      <td colSpan={colCount} className="py-2">
                        <GearPanel
                          segmentIndex={idx}
                          items={gearItems}
                          units={unitsOf(allocs[idx])}
                          selections={sels.filter((s) => s.segment_index === idx)}
                          onSelectionChange={onSelectionChange}
                        />
                      </td>
                    </tr>
                  ) : null,
                )
              : null}
          </tbody>
          <tfoot>
            <tr data-testid="plan-totals" className="border-t-2 border-white/20 font-medium">
              <td className="py-2 pr-4">Total</td>
              <td className="py-2 pr-4">{totals.distance_km} km</td>
              <td className="py-2 pr-4">{totals.elevation_gain_m} m</td>
              <td className="py-2 pr-4">{fmtDuration(totals.moving_minutes)}</td>
              <td className="py-2 pr-4">{fmtClock(totals.finish_arrival)}</td>
              <td className="py-2 pr-4">{Math.round(totals.fluid_ml)} ml</td>
              <td className="py-2 pr-4">{Math.round(totals.carb_g)} g</td>
              <td className="py-2 pr-4">{Math.round(totals.sodium_mg)} mg</td>
              {gearActive ? <td className="py-2 pr-4" /> : null}
              <td className="py-2 text-xs text-blue-100/50">
                {totals.rest_minutes > 0 ? `Rest ${totals.rest_minutes} min` : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

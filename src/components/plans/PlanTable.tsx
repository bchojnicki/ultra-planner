import type { AidStation, PlanTableResult } from "@/types";

const FLAGS = [
  ["water_only", "Water only"],
  ["food_available", "Food"],
  ["warm_meal", "Warm meal"],
  ["drop_bag_available", "Drop bag"],
  ["rest_area", "Rest area"],
  ["support_crew_allowed", "Crew"],
] as const;

function enabledFacilities(s: AidStation): string[] {
  return FLAGS.filter(([key]) => s[key]).map(([, label]) => label);
}

// Display-only rounding — the calc keeps full float precision (accuracy guardrail).
function fmtDuration(min: number): string {
  const total = Math.round(min);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  result: PlanTableResult;
}

export default function PlanTable({ result }: Props) {
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

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
      <h2 className="mb-4 text-lg font-semibold">Plan table</h2>
      <div className="overflow-x-auto">
        <table data-testid="plan-table" className="w-full border-collapse text-left text-sm whitespace-nowrap">
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
              <th className="py-2">Aid station</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const station = r.endStation;
              return (
                <tr key={r.label} data-testid="plan-row" className="border-t border-white/10 align-top">
                  <td className="py-2 pr-4 font-medium">{r.label}</td>
                  <td className="py-2 pr-4">{r.segment_distance_km} km</td>
                  <td className="py-2 pr-4">{r.segment_elevation_gain_m} m</td>
                  <td className="py-2 pr-4">{fmtDuration(r.moving_minutes)}</td>
                  <td className="py-2 pr-4">{fmtClock(r.arrival)}</td>
                  <td className="py-2 pr-4">{Math.round(r.fluid_ml)} ml</td>
                  <td className="py-2 pr-4">{Math.round(r.carb_g)} g</td>
                  <td className="py-2 pr-4">{Math.round(r.sodium_mg)} mg</td>
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

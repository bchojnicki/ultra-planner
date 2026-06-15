import { useState } from "react";
import type { AidStation } from "@/types";

const inputCls =
  "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none";

const FLAGS = [
  ["water_only", "Water only"],
  ["food_available", "Food"],
  ["warm_meal", "Warm meal"],
  ["drop_bag_available", "Drop bag"],
  ["rest_area", "Rest area"],
  ["support_crew_allowed", "Crew"],
] as const;

type FlagKey = (typeof FLAGS)[number][0];
type Flags = Record<FlagKey, boolean>;

const EMPTY_FLAGS: Flags = {
  water_only: false,
  food_available: false,
  warm_meal: false,
  drop_bag_available: false,
  rest_area: false,
  support_crew_allowed: false,
};

interface Props {
  planId: string;
  initialStations: AidStation[];
}

function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function sortStations(list: AidStation[]): AidStation[] {
  return [...list].sort((a, b) => a.cumulative_distance_km - b.cumulative_distance_km);
}

function enabledFacilities(s: AidStation): string {
  return FLAGS.filter(([key]) => s[key])
    .map(([, label]) => label)
    .join(", ");
}

export default function AidStationManager({ planId, initialStations }: Props) {
  const [stations, setStations] = useState<AidStation[]>(() => sortStations(initialStations));
  const [dist, setDist] = useState("");
  const [gain, setGain] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [flags, setFlags] = useState<Flags>(EMPTY_FLAGS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canAdd = num(dist) !== undefined && num(gain) !== undefined && !busy;

  async function add() {
    if (num(dist) === undefined || num(gain) === undefined || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        cumulative_distance_km: Number(dist),
        cumulative_elevation_gain_m: Number(gain),
        ...(time.trim() !== "" ? { time_spent_min: Number(time) } : {}),
        ...flags,
        ...(notes.trim() !== "" ? { notes: notes.trim() } : {}),
      };
      const res = await fetch(`/api/plans/${planId}/aid-stations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`add failed: ${res.status}`);
      const created = (await res.json()) as AidStation;
      setStations((prev) => sortStations([...prev, created]));
      setDist("");
      setGain("");
      setTime("");
      setNotes("");
      setFlags(EMPTY_FLAGS);
    } catch {
      setError("Couldn't add the station. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/aid-stations/${id}`, { method: "DELETE" });
    if (res.ok) {
      setStations((prev) => prev.filter((s) => s.id !== id));
    } else {
      setError("Couldn't delete the station. Please try again.");
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
      <h2 className="mb-4 text-lg font-semibold">Aid stations</h2>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="as-distance" className="mb-1 block text-sm text-blue-100/80">
            Cumulative distance (km)
          </label>
          <input
            id="as-distance"
            data-testid="as-distance"
            type="number"
            min="0"
            step="any"
            className={inputCls}
            value={dist}
            onChange={(e) => {
              setDist(e.target.value);
            }}
          />
        </div>
        <div>
          <label htmlFor="as-gain" className="mb-1 block text-sm text-blue-100/80">
            Cumulative elevation gain (m)
          </label>
          <input
            id="as-gain"
            data-testid="as-gain"
            type="number"
            min="0"
            step="any"
            className={inputCls}
            value={gain}
            onChange={(e) => {
              setGain(e.target.value);
            }}
          />
        </div>
        <div>
          <label htmlFor="as-time" className="mb-1 block text-sm text-blue-100/80">
            Time at station (min)
          </label>
          <input
            id="as-time"
            type="number"
            min="0"
            step="any"
            className={inputCls}
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
            }}
          />
        </div>
        <div>
          <label htmlFor="as-notes" className="mb-1 block text-sm text-blue-100/80">
            Crew notes
          </label>
          <input
            id="as-notes"
            className={inputCls}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm text-blue-100/80">Facilities</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {FLAGS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 text-sm text-blue-100/80">
                <input
                  type="checkbox"
                  checked={flags[key]}
                  onChange={(e) => {
                    setFlags((prev) => ({ ...prev, [key]: e.target.checked }));
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {error ? <p className="mb-2 text-sm text-red-300">{error}</p> : null}

      <button
        type="button"
        data-testid="as-add"
        disabled={!canAdd}
        onClick={() => void add()}
        className="rounded-lg border border-white/20 bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Add aid station
      </button>

      <ul className="mt-6 space-y-2">
        {stations.length === 0 ? (
          <li className="text-sm text-blue-100/50">No aid stations yet.</li>
        ) : (
          stations.map((s) => (
            <li
              key={s.id}
              data-testid="station-row"
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{s.cumulative_distance_km} km</span>
                <span className="text-blue-100/50"> · +{s.cumulative_elevation_gain_m} m</span>
                {enabledFacilities(s) ? <span className="text-blue-100/50"> · {enabledFacilities(s)}</span> : null}
                {s.notes ? <span className="text-blue-100/40"> · {s.notes}</span> : null}
              </div>
              <button
                type="button"
                data-testid="as-delete"
                aria-label={`Delete station at ${s.cumulative_distance_km} km`}
                onClick={() => void remove(s.id)}
                className="ml-3 rounded-md border border-white/20 px-2 py-1 text-xs text-blue-100/70 transition-colors hover:bg-white/10"
              >
                Delete
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

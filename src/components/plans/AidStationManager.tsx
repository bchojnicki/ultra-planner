import { useEffect, useRef, useState } from "react";
import type { AidStation } from "@/types";
import { AID_STATION_FLAGS as FLAGS, enabledFacilities } from "@/lib/aid-station-facilities";
import type { SaveStatus } from "@/components/hooks/useAutosave";
import HelpTooltip from "@/components/ui/HelpTooltip";
import { FIELD_HELP, type FieldHelpKey } from "@/lib/field-help";
import { fmtKm, fmtM } from "@/lib/format";

const inputCls =
  "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none";

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

// Editor draft: every field a string/bool, seeded from a station when its row opens.
interface EditDraft {
  cumulative_distance_km: string;
  cumulative_elevation_gain_m: string;
  cumulative_elevation_loss_m: string;
  time_spent_min: string;
  notes: string;
  flags: Flags;
}

const EDIT_NUM_FIELDS: { key: keyof EditDraft; label: string; help: FieldHelpKey }[] = [
  { key: "cumulative_distance_km", label: "Cumulative distance (km)", help: "cumulative_distance" },
  { key: "cumulative_elevation_gain_m", label: "Cumulative elevation gain (m)", help: "cumulative_gain" },
  { key: "cumulative_elevation_loss_m", label: "Cumulative elevation loss (m)", help: "cumulative_loss" },
  { key: "time_spent_min", label: "Time at station (min)", help: "time_at_station" },
];

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — will retry on next change",
};

interface Props {
  planId: string;
  initialStations: AidStation[];
  // Upper bound for edit-time distance validation (the corrected total race distance).
  totalDistanceKm?: number;
  // Emits the new sorted list after a successful add/delete/edit so a parent
  // (PlanEditor) can recompute the live plan table.
  onStationsChange?: (stations: AidStation[]) => void;
}

function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function sortStations(list: AidStation[]): AidStation[] {
  return [...list].sort((a, b) => a.cumulative_distance_km - b.cumulative_distance_km);
}

// Build an AidStationUpdate-shaped patch from a draft. Numeric fields are included
// only when well-formed; flags always; notes normalized ("" → null).
function buildPatch(draft: EditDraft) {
  return {
    ...(num(draft.cumulative_distance_km) !== undefined
      ? { cumulative_distance_km: Number(draft.cumulative_distance_km) }
      : {}),
    ...(num(draft.cumulative_elevation_gain_m) !== undefined
      ? { cumulative_elevation_gain_m: Number(draft.cumulative_elevation_gain_m) }
      : {}),
    ...(num(draft.cumulative_elevation_loss_m) !== undefined
      ? { cumulative_elevation_loss_m: Number(draft.cumulative_elevation_loss_m) }
      : {}),
    ...(num(draft.time_spent_min) !== undefined ? { time_spent_min: Number(draft.time_spent_min) } : {}),
    ...draft.flags,
    notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
  };
}

export default function AidStationManager({ planId, initialStations, totalDistanceKm = 0, onStationsChange }: Props) {
  const [stations, setStations] = useState<AidStation[]>(() => sortStations(initialStations));
  const [dist, setDist] = useState("");
  const [gain, setGain] = useState("");
  const [loss, setLoss] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [flags, setFlags] = useState<Flags>(EMPTY_FLAGS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline edit: one station open at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<SaveStatus>("idle");
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last-persisted snapshot of the station being edited (seeded at beginEdit,
  // advanced on each successful save). Used to revert the row if the editor
  // closes with an invalid distance, so a cancelled optimistic edit can't linger.
  const editSnapshot = useRef<AidStation | null>(null);

  // Cancel any pending debounced PATCH if the island tears down.
  useEffect(() => {
    return () => {
      if (editTimer.current) clearTimeout(editTimer.current);
    };
  }, []);

  const canAdd = num(dist) !== undefined && num(gain) !== undefined && !busy;

  async function add() {
    if (num(dist) === undefined || num(gain) === undefined || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        cumulative_distance_km: Number(dist),
        cumulative_elevation_gain_m: Number(gain),
        ...(num(loss) !== undefined ? { cumulative_elevation_loss_m: Number(loss) } : {}),
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
      const next = sortStations([...stations, created]);
      setStations(next);
      onStationsChange?.(next);
      setDist("");
      setGain("");
      setLoss("");
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
      const next = stations.filter((s) => s.id !== id);
      setStations(next);
      onStationsChange?.(next);
    } else {
      setError("Couldn't delete the station. Please try again.");
    }
  }

  // Distance is invalid when ≤ 0, ≥ total race distance, or duplicating another station.
  function distanceError(id: string, value: string): string | null {
    const d = num(value);
    if (d === undefined || d <= 0) return "Distance must be greater than 0.";
    if (totalDistanceKm > 0 && d >= totalDistanceKm)
      return `Distance must be below the total race distance (${Math.round(totalDistanceKm * 10) / 10} km).`;
    if (stations.some((s) => s.id !== id && s.cumulative_distance_km === d))
      return "Another station is already at this distance.";
    return null;
  }

  function beginEdit(s: AidStation) {
    setEditingId(s.id);
    editSnapshot.current = s;
    setEditError(null);
    setEditStatus("idle");
    setDraft({
      cumulative_distance_km: String(s.cumulative_distance_km),
      cumulative_elevation_gain_m: String(s.cumulative_elevation_gain_m),
      cumulative_elevation_loss_m: String(s.cumulative_elevation_loss_m),
      time_spent_min: String(s.time_spent_min),
      notes: s.notes ?? "",
      flags: {
        water_only: s.water_only,
        food_available: s.food_available,
        warm_meal: s.warm_meal,
        drop_bag_available: s.drop_bag_available,
        rest_area: s.rest_area,
        support_crew_allowed: s.support_crew_allowed,
      },
    });
  }

  async function savePatch(id: string, patch: ReturnType<typeof buildPatch>) {
    try {
      const res = await fetch(`/api/aid-stations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`patch failed: ${res.status}`);
      setEditStatus("saved");
      // Advance the snapshot so a later revert reflects what's actually persisted.
      if (editSnapshot.current?.id === id) editSnapshot.current = { ...editSnapshot.current, ...patch };
    } catch {
      setEditStatus("error");
    }
  }

  // A draft field changed. While the distance is invalid we freeze: show the error,
  // don't touch the persisted list, and withhold the PATCH. When valid we apply the
  // patch optimistically (so the table tracks live, in place — no re-sort yet) and
  // debounce the save.
  function onDraftChange(next: EditDraft) {
    setDraft(next);
    if (!editingId) return;
    const distErr = distanceError(editingId, next.cumulative_distance_km);
    setEditError(distErr);
    if (distErr) {
      if (editTimer.current) clearTimeout(editTimer.current);
      setEditStatus("idle");
      return;
    }
    const patch = buildPatch(next);
    const optimistic = stations.map((s) => (s.id === editingId ? { ...s, ...patch } : s));
    setStations(optimistic);
    onStationsChange?.(optimistic);
    if (editTimer.current) clearTimeout(editTimer.current);
    setEditStatus("saving");
    editTimer.current = setTimeout(() => {
      void savePatch(editingId, patch);
    }, 500);
  }

  // Close the editor: flush a final save if valid, then re-sort (so a changed
  // distance moves the row) and emit. An invalid draft is discarded — the station
  // keeps its last persisted values.
  function endEdit() {
    let base = stations;
    if (editingId && draft) {
      if (distanceError(editingId, draft.cumulative_distance_km)) {
        // Invalid distance → discard the draft and revert the row to its last
        // persisted snapshot, so no un-saved optimistic value is left on screen.
        const snap = editSnapshot.current;
        if (snap) base = stations.map((s) => (s.id === editingId ? snap : s));
      } else {
        if (editTimer.current) clearTimeout(editTimer.current);
        void savePatch(editingId, buildPatch(draft));
      }
    }
    const sorted = sortStations(base);
    setStations(sorted);
    onStationsChange?.(sorted);
    editSnapshot.current = null;
    setEditingId(null);
    setDraft(null);
    setEditError(null);
    setEditStatus("idle");
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
      <h2 className="mb-4 text-lg font-semibold">Aid stations</h2>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center">
            <label htmlFor="as-distance" className="text-sm text-blue-100/80">
              Cumulative distance (km)
            </label>
            <HelpTooltip text={FIELD_HELP.cumulative_distance} label="Cumulative distance (km)" />
          </div>
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
          <div className="mb-1 flex items-center">
            <label htmlFor="as-gain" className="text-sm text-blue-100/80">
              Cumulative elevation gain (m)
            </label>
            <HelpTooltip text={FIELD_HELP.cumulative_gain} label="Cumulative elevation gain (m)" />
          </div>
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
          <div className="mb-1 flex items-center">
            <label htmlFor="as-loss" className="text-sm text-blue-100/80">
              Cumulative elevation loss (m)
            </label>
            <HelpTooltip text={FIELD_HELP.cumulative_loss} label="Cumulative elevation loss (m)" />
          </div>
          <input
            id="as-loss"
            data-testid="as-loss"
            type="number"
            min="0"
            step="any"
            className={inputCls}
            value={loss}
            onChange={(e) => {
              setLoss(e.target.value);
            }}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center">
            <label htmlFor="as-time" className="text-sm text-blue-100/80">
              Time at station (min)
            </label>
            <HelpTooltip text={FIELD_HELP.time_at_station} label="Time at station (min)" />
          </div>
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
          stations.map((s) => {
            const isEditing = editingId === s.id;
            return (
              <li
                key={s.id}
                data-testid="station-row"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{fmtKm(s.cumulative_distance_km)} km</span>
                    <span className="text-blue-100/50"> · +{fmtM(s.cumulative_elevation_gain_m)} m</span>
                    {s.cumulative_elevation_loss_m > 0 ? (
                      <span className="text-blue-100/50"> · −{fmtM(s.cumulative_elevation_loss_m)} m</span>
                    ) : null}
                    {enabledFacilities(s).length > 0 ? (
                      <span className="text-blue-100/50"> · {enabledFacilities(s).join(", ")}</span>
                    ) : null}
                    {s.notes ? <span className="text-blue-100/40"> · {s.notes}</span> : null}
                  </div>
                  <div className="ml-3 flex shrink-0 gap-1">
                    <button
                      type="button"
                      data-testid="as-edit"
                      aria-expanded={isEditing}
                      aria-label={`Edit station at ${s.cumulative_distance_km} km`}
                      onClick={() => {
                        if (isEditing) endEdit();
                        else beginEdit(s);
                      }}
                      className="rounded-md border border-white/20 px-2 py-1 text-xs text-blue-100/70 transition-colors hover:bg-white/10"
                    >
                      {isEditing ? "Done" : "Edit"}
                    </button>
                    <button
                      type="button"
                      data-testid="as-delete"
                      aria-label={`Delete station at ${s.cumulative_distance_km} km`}
                      onClick={() => void remove(s.id)}
                      className="rounded-md border border-white/20 px-2 py-1 text-xs text-blue-100/70 transition-colors hover:bg-white/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isEditing && draft ? (
                  <div data-testid="as-edit-panel" className="mt-3 space-y-3 border-t border-white/10 pt-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {EDIT_NUM_FIELDS.map(({ key, label, help }) => (
                        <div key={key}>
                          <div className="mb-1 flex items-center">
                            <label className="text-xs text-blue-100/70">{label}</label>
                            <HelpTooltip text={FIELD_HELP[help]} label={label} />
                          </div>
                          <input
                            data-testid={`as-edit-${key}`}
                            type="number"
                            min="0"
                            step="any"
                            className={inputCls}
                            value={draft[key] as string}
                            onChange={(e) => {
                              onDraftChange({ ...draft, [key]: e.target.value });
                            }}
                          />
                        </div>
                      ))}
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs text-blue-100/70">Crew notes</label>
                        <input
                          data-testid="as-edit-notes"
                          className={inputCls}
                          value={draft.notes}
                          onChange={(e) => {
                            onDraftChange({ ...draft, notes: e.target.value });
                          }}
                        />
                      </div>
                    </div>
                    <fieldset>
                      <legend className="mb-1 text-xs text-blue-100/70">Facilities</legend>
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {FLAGS.map(([key, label]) => (
                          <label key={key} className="flex items-center gap-1.5 text-sm text-blue-100/80">
                            <input
                              type="checkbox"
                              data-testid={`as-edit-flag-${key}`}
                              checked={draft.flags[key]}
                              onChange={(e) => {
                                onDraftChange({ ...draft, flags: { ...draft.flags, [key]: e.target.checked } });
                              }}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="flex items-center justify-between">
                      <span data-testid="as-edit-status" className="text-xs text-blue-100/60" aria-live="polite">
                        {STATUS_TEXT[editStatus]}
                      </span>
                      {editError ? (
                        <span data-testid="as-edit-error" className="text-xs text-red-300">
                          {editError}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

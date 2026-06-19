import { useCallback, useState } from "react";
import type { AidStation, Plan, PlanUpdate } from "@/types";
import { useAutosave, type SaveStatus } from "@/components/hooks/useAutosave";
import GpxImport from "@/components/plans/GpxImport";
import HelpTooltip from "@/components/ui/HelpTooltip";
import { FIELD_HELP, type FieldHelpKey } from "@/lib/field-help";

const inputCls =
  "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none";

interface Props {
  plan: Plan;
  // Emits the current parsed Plan on every edit so a parent (PlanEditor) can
  // recompute the live plan table. Autosave is unaffected.
  onParamsChange?: (plan: Plan) => void;
  // When provided, renders the GPX upload control. The parent remounts this form
  // after a successful import (via a key bump), so the fields re-seed from the
  // imported plan; this callback hands the imported plan + stations upward.
  onGpxImported?: (plan: Plan, stations: AidStation[]) => void;
  // Whether importing would overwrite real data (drives the confirm prompt).
  hasExistingData?: boolean;
}

interface FormState {
  name: string;
  total_distance_km: string;
  total_elevation_gain_m: string;
  total_elevation_loss_m: string;
  start_time_local: string;
  hours: string;
  minutes: string;
  hourly_fluid_ml: string;
  hourly_carb_g: string;
  hourly_sodium_mg: string;
}

const NUMERIC_FIELDS: { key: keyof FormState; label: string; help: FieldHelpKey }[] = [
  { key: "total_distance_km", label: "Total distance (km)", help: "total_distance" },
  { key: "total_elevation_gain_m", label: "Elevation gain (m)", help: "elevation_gain" },
  { key: "total_elevation_loss_m", label: "Elevation loss (m)", help: "elevation_loss" },
  { key: "hourly_fluid_ml", label: "Hourly fluid (ml)", help: "hourly_fluid" },
  { key: "hourly_carb_g", label: "Hourly carbs (g)", help: "hourly_carbs" },
  { key: "hourly_sodium_mg", label: "Hourly sodium (mg)", help: "hourly_sodium" },
];

function isoToLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function initialState(plan: Plan): FormState {
  return {
    name: plan.name,
    total_distance_km: String(plan.total_distance_km),
    total_elevation_gain_m: String(plan.total_elevation_gain_m),
    total_elevation_loss_m: String(plan.total_elevation_loss_m),
    start_time_local: isoToLocal(plan.start_time),
    hours: String(Math.floor(plan.total_expected_minutes / 60)),
    minutes: String(plan.total_expected_minutes % 60),
    hourly_fluid_ml: String(plan.hourly_fluid_ml),
    hourly_carb_g: String(plan.hourly_carb_g),
    hourly_sodium_mg: String(plan.hourly_sodium_mg),
  };
}

// Build a PlanUpdate from the form, including only valid fields so autosave
// never sends a value the endpoint's zod schema would 400 on.
function buildPatch(s: FormState): PlanUpdate {
  const patch: PlanUpdate = {};
  if (s.name.trim() !== "") patch.name = s.name.trim();

  const td = num(s.total_distance_km);
  if (td !== undefined) patch.total_distance_km = td;
  const teg = num(s.total_elevation_gain_m);
  if (teg !== undefined) patch.total_elevation_gain_m = teg;
  const tel = num(s.total_elevation_loss_m);
  if (tel !== undefined) patch.total_elevation_loss_m = tel;
  const ff = num(s.hourly_fluid_ml);
  if (ff !== undefined) patch.hourly_fluid_ml = ff;
  const fc = num(s.hourly_carb_g);
  if (fc !== undefined) patch.hourly_carb_g = fc;
  const fs = num(s.hourly_sodium_mg);
  if (fs !== undefined) patch.hourly_sodium_mg = fs;

  const h = num(s.hours);
  const m = num(s.minutes);
  if (h !== undefined && m !== undefined) patch.total_expected_minutes = Math.round(h) * 60 + Math.round(m);

  if (s.start_time_local !== "") {
    const d = new Date(s.start_time_local);
    if (!Number.isNaN(d.getTime())) patch.start_time = d.toISOString();
  }
  return patch;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — will retry on next change",
};

export default function RaceSetupForm({ plan, onParamsChange, onGpxImported, hasExistingData = false }: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(plan));

  const save = useCallback(
    async (patch: PlanUpdate) => {
      if (Object.keys(patch).length === 0) return;
      const res = await fetch(`/api/plans/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
    },
    [plan.id],
  );

  const { status, schedule } = useAutosave<PlanUpdate>(save);

  const update = (field: keyof FormState, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    schedule(buildPatch(next));
    // Merge valid parsed fields over the base plan so the parent has a full Plan.
    onParamsChange?.({ ...plan, ...buildPatch(next) });
  };

  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Race parameters</h2>
        <span data-testid="save-status" className="text-xs text-blue-100/60" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
      </div>

      {onGpxImported ? (
        <GpxImport planId={plan.id} hasExistingData={hasExistingData} onImported={onGpxImported} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="rsf-name" className="mb-1 block text-sm text-blue-100/80">
            Plan name
          </label>
          <input
            id="rsf-name"
            className={inputCls}
            value={form.name}
            onChange={(e) => {
              update("name", e.target.value);
            }}
          />
        </div>

        {NUMERIC_FIELDS.map(({ key, label, help }) => (
          <div key={key}>
            <div className="mb-1 flex items-center">
              <label htmlFor={`rsf-${key}`} className="text-sm text-blue-100/80">
                {label}
              </label>
              <HelpTooltip text={FIELD_HELP[help]} label={label} />
            </div>
            <input
              id={`rsf-${key}`}
              type="number"
              min="0"
              step="any"
              className={inputCls}
              value={form[key]}
              onChange={(e) => {
                update(key, e.target.value);
              }}
            />
          </div>
        ))}

        <div>
          <div className="mb-1 flex items-center">
            <label htmlFor="rsf-start" className="text-sm text-blue-100/80">
              Start time
            </label>
            <HelpTooltip text={FIELD_HELP.start_time} label="Start time" />
          </div>
          <input
            id="rsf-start"
            type="datetime-local"
            className={inputCls}
            value={form.start_time_local}
            onChange={(e) => {
              update("start_time_local", e.target.value);
            }}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center">
            <span className="text-sm text-blue-100/80">Expected finish</span>
            <HelpTooltip text={FIELD_HELP.expected_finish} label="Expected finish" />
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label="Expected finish hours"
              type="number"
              min="0"
              step="1"
              className={inputCls}
              value={form.hours}
              onChange={(e) => {
                update("hours", e.target.value);
              }}
            />
            <span className="text-blue-100/60">h</span>
            <input
              aria-label="Expected finish minutes"
              type="number"
              min="0"
              max="59"
              step="1"
              className={inputCls}
              value={form.minutes}
              onChange={(e) => {
                update("minutes", e.target.value);
              }}
            />
            <span className="text-blue-100/60">m</span>
          </div>
        </div>
      </div>
    </section>
  );
}

import { useCallback, useState } from "react";
import type { GearItem, GearItemUpdate, GearKind } from "@/types";
import { useAutosave, type SaveStatus } from "@/components/hooks/useAutosave";

const inputCls =
  "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none";

// The fueling field each kind exposes. carb_ratio only matters for carb sources
// (it weights the auto-suggestion split); a water carrier holds capacity, a salt cap sodium.
type FieldKey = "carb_g" | "sodium_mg" | "fluid_ml" | "capacity_ml" | "carb_ratio";

const FIELD_LABELS: Record<FieldKey, string> = {
  carb_g: "Carbs / unit (g)",
  sodium_mg: "Sodium / unit (mg)",
  fluid_ml: "Fluid / serving (ml)",
  capacity_ml: "Capacity / unit (ml)",
  carb_ratio: "Carb ratio",
};

const KIND_FIELDS: Record<GearKind, FieldKey[]> = {
  gel: ["carb_g", "sodium_mg", "carb_ratio"],
  drink: ["carb_g", "fluid_ml", "sodium_mg", "carb_ratio"],
  solid_food: ["carb_g", "sodium_mg", "carb_ratio"],
  water_carrier: ["capacity_ml"],
  salt_cap: ["sodium_mg"],
};

const KIND_LABELS: Record<GearKind, string> = {
  gel: "Gel",
  drink: "Carb drink",
  solid_food: "Solid food",
  water_carrier: "Water carrier",
  salt_cap: "Salt cap",
};

const KIND_ORDER: GearKind[] = ["gel", "drink", "solid_food", "water_carrier", "salt_cap"];

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — will retry on next change",
};

interface Props {
  planId: string;
  initialItems: GearItem[];
  // Emits the new list after an add/delete/edit so a parent (PlanEditor) can
  // recompute the live plan table. Optional — the catalog persists regardless.
  onItemsChange?: (items: GearItem[]) => void;
}

function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// A relevant field that is cleared becomes null (unset); a valid value becomes a
// number; invalid text is skipped (undefined) so autosave never sends a 400.
function fieldVal(v: string): number | null | undefined {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

interface RowForm {
  name: string;
  carb_g: string;
  sodium_mg: string;
  fluid_ml: string;
  capacity_ml: string;
  carb_ratio: string;
}

function strOrEmpty(v: number | null): string {
  return v === null ? "" : String(v);
}

function itemToForm(item: GearItem): RowForm {
  return {
    name: item.name,
    carb_g: strOrEmpty(item.carb_g),
    sodium_mg: strOrEmpty(item.sodium_mg),
    fluid_ml: strOrEmpty(item.fluid_ml),
    capacity_ml: strOrEmpty(item.capacity_ml),
    carb_ratio: String(item.carb_ratio),
  };
}

function buildPatch(kind: GearKind, form: RowForm): GearItemUpdate {
  const patch: GearItemUpdate = {};
  const fields = KIND_FIELDS[kind];
  if (form.name.trim() !== "") patch.name = form.name.trim();
  if (fields.includes("carb_g")) {
    const v = fieldVal(form.carb_g);
    if (v !== undefined) patch.carb_g = v;
  }
  if (fields.includes("sodium_mg")) {
    const v = fieldVal(form.sodium_mg);
    if (v !== undefined) patch.sodium_mg = v;
  }
  if (fields.includes("fluid_ml")) {
    const v = fieldVal(form.fluid_ml);
    if (v !== undefined) patch.fluid_ml = v;
  }
  if (fields.includes("capacity_ml")) {
    const v = fieldVal(form.capacity_ml);
    if (v !== undefined) patch.capacity_ml = v;
  }
  if (fields.includes("carb_ratio")) {
    const n = num(form.carb_ratio);
    if (n !== undefined) patch.carb_ratio = n;
  }
  return patch;
}

// One editable catalog row: relevant fields for its kind, autosaved per keystroke.
function GearItemRow({
  item,
  onChange,
  onDelete,
}: {
  item: GearItem;
  onChange: (item: GearItem) => void;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState<RowForm>(() => itemToForm(item));

  const save = useCallback(
    async (patch: GearItemUpdate) => {
      if (Object.keys(patch).length === 0) return;
      const res = await fetch(`/api/gear-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
    },
    [item.id],
  );

  const { status, schedule } = useAutosave<GearItemUpdate>(save);

  const update = (field: keyof RowForm, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    const patch = buildPatch(item.kind, next);
    schedule(patch);
    onChange({ ...item, ...patch });
  };

  return (
    <li data-testid="gear-row" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-purple-200/80 uppercase">{KIND_LABELS[item.kind]}</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-blue-100/60" aria-live="polite">
            {STATUS_TEXT[status]}
          </span>
          <button
            type="button"
            data-testid="gear-delete"
            aria-label={`Delete ${KIND_LABELS[item.kind]} ${item.name}`}
            onClick={() => {
              onDelete(item.id);
            }}
            className="rounded-md border border-white/20 px-2 py-1 text-xs text-blue-100/70 transition-colors hover:bg-white/10"
          >
            Delete
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label htmlFor={`gear-${item.id}-name`} className="mb-1 block text-sm text-blue-100/80">
            Name
          </label>
          <input
            id={`gear-${item.id}-name`}
            className={inputCls}
            value={form.name}
            onChange={(e) => {
              update("name", e.target.value);
            }}
          />
        </div>
        {KIND_FIELDS[item.kind].map((field) => (
          <div key={field}>
            <label htmlFor={`gear-${item.id}-${field}`} className="mb-1 block text-sm text-blue-100/80">
              {FIELD_LABELS[field]}
            </label>
            <input
              id={`gear-${item.id}-${field}`}
              type="number"
              min="0"
              step="any"
              className={inputCls}
              value={form[field]}
              onChange={(e) => {
                update(field, e.target.value);
              }}
            />
          </div>
        ))}
      </div>
    </li>
  );
}

export default function GearProfileForm({ planId, initialItems, onItemsChange }: Props) {
  const [items, setItems] = useState<GearItem[]>(initialItems);
  const [kind, setKind] = useState<GearKind>("gel");
  const [draft, setDraft] = useState<RowForm>({
    name: "",
    carb_g: "",
    sodium_mg: "",
    fluid_ml: "",
    capacity_ml: "",
    carb_ratio: "1",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdd = draft.name.trim() !== "" && !busy;

  function emit(next: GearItem[]) {
    setItems(next);
    onItemsChange?.(next);
  }

  async function add() {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      const patch = buildPatch(kind, draft);
      const body = { kind, ...patch, name: draft.name.trim() };
      const res = await fetch(`/api/plans/${planId}/gear-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`add failed: ${res.status}`);
      const created = (await res.json()) as GearItem;
      emit([...items, created]);
      setDraft({ name: "", carb_g: "", sodium_mg: "", fluid_ml: "", capacity_ml: "", carb_ratio: "1" });
    } catch {
      setError("Couldn't add the gear item. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/gear-items/${id}`, { method: "DELETE" });
    if (res.ok) {
      emit(items.filter((i) => i.id !== id));
    } else {
      setError("Couldn't delete the gear item. Please try again.");
    }
  }

  function onRowChange(updated: GearItem) {
    emit(items.map((i) => (i.id === updated.id ? updated : i)));
  }

  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
      <h2 className="mb-1 text-lg font-semibold">Gear</h2>
      <p className="mb-4 text-sm text-blue-100/60">
        Optional. Add your fueling items to see the plan table in unit-level quantities. Skip it to keep gram/ml
        targets.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="gear-add-kind" className="mb-1 block text-sm text-blue-100/80">
            Type
          </label>
          <select
            id="gear-add-kind"
            data-testid="gear-add-kind"
            className={inputCls}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as GearKind);
            }}
          >
            {KIND_ORDER.map((k) => (
              <option key={k} value={k} className="bg-slate-800">
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="gear-add-name" className="mb-1 block text-sm text-blue-100/80">
            Name
          </label>
          <input
            id="gear-add-name"
            data-testid="gear-add-name"
            className={inputCls}
            placeholder="e.g. SIS Beta gel"
            value={draft.name}
            onChange={(e) => {
              setDraft((d) => ({ ...d, name: e.target.value }));
            }}
          />
        </div>
        {KIND_FIELDS[kind].map((field) => (
          <div key={field}>
            <label htmlFor={`gear-add-${field}`} className="mb-1 block text-sm text-blue-100/80">
              {FIELD_LABELS[field]}
            </label>
            <input
              id={`gear-add-${field}`}
              type="number"
              min="0"
              step="any"
              className={inputCls}
              value={draft[field]}
              onChange={(e) => {
                setDraft((d) => ({ ...d, [field]: e.target.value }));
              }}
            />
          </div>
        ))}
      </div>

      {error ? <p className="mb-2 text-sm text-red-300">{error}</p> : null}

      <button
        type="button"
        data-testid="gear-add"
        disabled={!canAdd}
        onClick={() => void add()}
        className="rounded-lg border border-white/20 bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Add gear
      </button>

      <ul className="mt-6 space-y-3">
        {items.length === 0 ? (
          <li className="text-sm text-blue-100/50">No gear yet — the plan table will show gram/ml targets.</li>
        ) : (
          items.map((item) => <GearItemRow key={item.id} item={item} onChange={onRowChange} onDelete={remove} />)
        )}
      </ul>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AidStation, GearItem, GearSegmentSelection, Plan } from "@/types";
import { computePlanTable } from "@/lib/plan-table";
import { computeGearAllocation, staleSegmentIndexes } from "@/lib/gear-allocation";
import type { SaveStatus } from "@/components/hooks/useAutosave";
import RaceSetupForm from "@/components/plans/RaceSetupForm";
import GearProfileForm from "@/components/plans/GearProfileForm";
import AidStationManager from "@/components/plans/AidStationManager";
import PlanTable, { type SelectionPatch } from "@/components/plans/PlanTable";

interface Props {
  plan: Plan;
  initialStations: AidStation[];
  initialGearItems: GearItem[];
  initialSelections: GearSegmentSelection[];
}

// One island root holding the live params + stations + gear so the plan table can
// recompute from shared state. Sub-forms keep their own behavior (autosave, add/delete)
// and emit changes upward. Gear allocation (S-03) decorates the S-02 table output:
// per segment, the gram/ml targets become unit-level suggestions the runner can cap or
// override per stage. Selections persist sparsely; only deviations from the suggestion.
export default function PlanEditor({ plan, initialStations, initialGearItems, initialSelections }: Props) {
  const [params, setParams] = useState<Plan>(plan);
  const [stations, setStations] = useState<AidStation[]>(initialStations);
  const [gearItems, setGearItems] = useState<GearItem[]>(initialGearItems);
  const [selections, setSelections] = useState<GearSegmentSelection[]>(initialSelections);
  // Shared save status for per-segment selection writes (saving/saved/error), surfaced
  // in the plan table. Mirrors RaceSetupForm's passive indicator; a failed write keeps the
  // optimistic local value and is superseded by the next edit (retry-on-next-change).
  const [selectionStatus, setSelectionStatus] = useState<SaveStatus>("idle");

  const result = useMemo(() => computePlanTable(params, stations), [params, stations]);

  // Per-segment unit allocation, parallel to the table rows (index = segment_index).
  const allocations = useMemo(() => {
    if (!result.ok) return [];
    return result.rows.map((row, idx) =>
      computeGearAllocation({
        carbTarget: row.carb_g,
        fluidTarget: row.fluid_ml,
        sodiumTarget: row.sodium_mg,
        items: gearItems,
        selections: selections.filter((s) => s.segment_index === idx),
      }),
    );
  }, [result, gearItems, selections]);

  // Debounced per-(segment,item) PUT timers; the local state update is immediate so the
  // table re-suggests live while the runner types.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clear any pending debounce timers on unmount so a fired timer never fetches against a
  // torn-down island (mirrors the cleanup in useAutosave).
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
    };
  }, []);

  const putSelection = useCallback(
    async (segmentIndex: number, gearItemId: string, patch: SelectionPatch) => {
      setSelectionStatus("saving");
      try {
        const res = await fetch(`/api/plans/${plan.id}/gear-selections`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gear_item_id: gearItemId, segment_index: segmentIndex, ...patch }),
        });
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
        setSelectionStatus("saved");
      } catch {
        setSelectionStatus("error");
      }
    },
    [plan.id],
  );

  const onSelectionChange = useCallback(
    (segmentIndex: number, gearItemId: string, patch: SelectionPatch) => {
      setSelections((prev) => {
        const rest = prev.filter((s) => !(s.segment_index === segmentIndex && s.gear_item_id === gearItemId));
        if (patch.limit_units === null && patch.override_units === null) return rest;
        const existing = prev.find((s) => s.segment_index === segmentIndex && s.gear_item_id === gearItemId);
        const row: GearSegmentSelection = {
          id: existing?.id ?? `tmp-${segmentIndex}-${gearItemId}`,
          plan_id: plan.id,
          gear_item_id: gearItemId,
          segment_index: segmentIndex,
          limit_units: patch.limit_units,
          override_units: patch.override_units,
          created_at: existing?.created_at ?? "",
          updated_at: "",
        };
        return [...rest, row];
      });

      const key = `${segmentIndex}:${gearItemId}`;
      const pending = timers.current.get(key);
      if (pending) clearTimeout(pending);
      timers.current.set(
        key,
        setTimeout(() => {
          void putSelection(segmentIndex, gearItemId, patch);
        }, 600),
      );
    },
    [plan.id, putSelection],
  );

  // When an aid-station change alters the segment count, selections whose index no longer
  // maps to a real leg are dropped (locally + on the server) so a quantity is never
  // mis-attributed; auto-suggest re-seeds the affected segments.
  const onStationsChange = useCallback(
    (next: AidStation[]) => {
      const prevCount = result.ok ? result.rows.length : 0;
      const nextResult = computePlanTable(params, next);
      const nextCount = nextResult.ok ? nextResult.rows.length : 0;
      const stale = staleSegmentIndexes(prevCount, nextCount, selections);
      if (stale.length > 0) {
        const staleSet = new Set(stale);
        const toClear = selections.filter((s) => staleSet.has(s.segment_index));
        setSelections((prev) => prev.filter((s) => !staleSet.has(s.segment_index)));
        for (const s of toClear)
          void putSelection(s.segment_index, s.gear_item_id, { limit_units: null, override_units: null });
      }
      setStations(next);
    },
    [params, result, selections, putSelection],
  );

  return (
    <>
      <RaceSetupForm plan={plan} onParamsChange={setParams} />
      <GearProfileForm planId={plan.id} initialItems={initialGearItems} onItemsChange={setGearItems} />
      <AidStationManager planId={plan.id} initialStations={initialStations} onStationsChange={onStationsChange} />
      <PlanTable
        result={result}
        items={gearItems}
        allocations={allocations}
        selections={selections}
        onSelectionChange={onSelectionChange}
        selectionStatus={selectionStatus}
      />
    </>
  );
}

import { useMemo, useState } from "react";
import type { AidStation, GearItem, Plan } from "@/types";
import { computePlanTable } from "@/lib/plan-table";
import RaceSetupForm from "@/components/plans/RaceSetupForm";
import GearProfileForm from "@/components/plans/GearProfileForm";
import AidStationManager from "@/components/plans/AidStationManager";
import PlanTable from "@/components/plans/PlanTable";

interface Props {
  plan: Plan;
  initialStations: AidStation[];
  initialGearItems: GearItem[];
}

// One island root holding the live params + stations so the plan table (S-02)
// can recompute from shared state. RaceSetupForm and AidStationManager keep their
// own behavior (autosave, add/delete) and emit changes upward. The Gear catalog
// (S-03) slots between race setup and aid stations; lifting its items + selections
// into the live table happens in Phase 5.
export default function PlanEditor({ plan, initialStations, initialGearItems }: Props) {
  const [params, setParams] = useState<Plan>(plan);
  const [stations, setStations] = useState<AidStation[]>(initialStations);

  const result = useMemo(() => computePlanTable(params, stations), [params, stations]);

  return (
    <>
      <RaceSetupForm plan={plan} onParamsChange={setParams} />
      <GearProfileForm planId={plan.id} initialItems={initialGearItems} />
      <AidStationManager planId={plan.id} initialStations={initialStations} onStationsChange={setStations} />
      <PlanTable result={result} />
    </>
  );
}

import { useMemo, useState } from "react";
import type { AidStation, Plan } from "@/types";
import { computePlanTable } from "@/lib/plan-table";
import RaceSetupForm from "@/components/plans/RaceSetupForm";
import AidStationManager from "@/components/plans/AidStationManager";
import PlanTable from "@/components/plans/PlanTable";

interface Props {
  plan: Plan;
  initialStations: AidStation[];
}

// One island root holding the live params + stations so the plan table (Phase 3)
// can recompute from shared state. RaceSetupForm and AidStationManager keep their
// own behavior (autosave, add/delete) and emit changes upward.
export default function PlanEditor({ plan, initialStations }: Props) {
  const [params, setParams] = useState<Plan>(plan);
  const [stations, setStations] = useState<AidStation[]>(initialStations);

  const result = useMemo(() => computePlanTable(params, stations), [params, stations]);

  return (
    <>
      <RaceSetupForm plan={plan} onParamsChange={setParams} />
      <AidStationManager planId={plan.id} initialStations={initialStations} onStationsChange={setStations} />
      <PlanTable result={result} />
    </>
  );
}

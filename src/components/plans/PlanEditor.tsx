import { useState } from "react";
import type { AidStation, Plan } from "@/types";
import RaceSetupForm from "@/components/plans/RaceSetupForm";
import AidStationManager from "@/components/plans/AidStationManager";

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

  return (
    <>
      <RaceSetupForm plan={plan} onParamsChange={setParams} />
      <AidStationManager planId={plan.id} initialStations={initialStations} onStationsChange={setStations} />

      {/* Phase 3 replaces this placeholder with <PlanTable>, computed from params + stations. */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-6 text-sm text-blue-100/50 backdrop-blur-xl">
        Your plan table will appear here ({stations.length} aid station{stations.length === 1 ? "" : "s"} ·{" "}
        {params.total_distance_km} km).
      </section>
    </>
  );
}

import { useState } from "react";
import type { AidStation, Plan } from "@/types";
import { distance3dKm, elevationGainLoss, parseGpx, projectWaypointsToStations } from "@/lib/gpx";

// Generous ceiling — a multi-day race track is a few hundred KB; this only guards
// against a wildly wrong file selection, not realistic GPX.
const MAX_GPX_BYTES = 20 * 1024 * 1024;

interface Props {
  planId: string;
  // True when the plan already has race details or stations, so importing would
  // overwrite real data → confirm first.
  hasExistingData: boolean;
  onImported: (plan: Plan, stations: AidStation[]) => void;
}

type Status = "idle" | "importing" | "error" | "done";

// GPX upload control (gpx-import, Phase 5). Parses + computes entirely in the
// browser (only small numbers are POSTed, never the raw file), confirms before
// overwriting, then calls the replace-all import endpoint. The imported raw GPX
// values seed both the gpx_* columns and the (initially identical) corrected
// totals; the runner corrects the totals afterward in the race form.
export default function GpxImport({ planId, hasExistingData, onImported }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function handleFile(file: File) {
    setMessage("");

    if (file.size > MAX_GPX_BYTES) {
      setStatus("error");
      setMessage("That file is too large to import.");
      return;
    }

    let gpx_distance_km: number;
    let gpx_elevation_gain_m: number;
    let gpx_elevation_loss_m: number;
    let stations: ReturnType<typeof projectWaypointsToStations>;
    try {
      const { track, waypoints } = parseGpx(await file.text());
      if (track.length === 0) {
        setStatus("error");
        setMessage("No track points found — is this a GPX track export?");
        return;
      }
      const elevation = elevationGainLoss(track);
      gpx_distance_km = distance3dKm(track);
      gpx_elevation_gain_m = elevation.gain_m;
      gpx_elevation_loss_m = elevation.loss_m;
      stations = projectWaypointsToStations(track, waypoints);
    } catch {
      setStatus("error");
      setMessage("Couldn't read that file as GPX. Please pick a valid .gpx export.");
      return;
    }

    if (
      hasExistingData &&
      !window.confirm("Importing replaces the current race details and all aid stations. Continue?")
    ) {
      setStatus("idle");
      return;
    }

    setStatus("importing");
    try {
      const res = await fetch(`/api/plans/${planId}/gpx-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gpx_distance_km,
          gpx_elevation_gain_m,
          gpx_elevation_loss_m,
          // Corrected totals start equal to the raw GPX values; the runner edits them.
          total_distance_km: gpx_distance_km,
          total_elevation_gain_m: gpx_elevation_gain_m,
          total_elevation_loss_m: gpx_elevation_loss_m,
          stations,
        }),
      });
      if (!res.ok) throw new Error(`import failed: ${res.status}`);
      const { plan, stations: imported } = (await res.json()) as { plan: Plan; stations: AidStation[] };
      setStatus("done");
      setMessage(`Imported ${imported.length} aid station${imported.length === 1 ? "" : "s"}.`);
      onImported(plan, imported);
    } catch {
      // F1 (impl-review p3): the import is non-transactional, so a failure here may
      // already have cleared the old stations. Say so explicitly so the runner re-imports.
      setStatus("error");
      setMessage("Import failed — your plan may be partly updated. Please try importing again.");
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Import GPX</span>
        <input
          data-testid="gpx-file"
          type="file"
          accept=".gpx,application/gpx+xml"
          disabled={status === "importing"}
          aria-label="Import GPX file"
          className="text-sm text-blue-100/80 file:mr-3 file:rounded-md file:border file:border-white/20 file:bg-white/10 file:px-3 file:py-1.5 file:text-white"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Clear so re-selecting the same file fires change again.
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
        {status === "importing" ? <span className="text-xs text-blue-100/60">Importing…</span> : null}
      </div>
      <p className="mt-2 text-xs text-blue-100/50">
        Auto-fills distance and elevation from the track and adds an aid station for each waypoint. You can correct the
        totals afterward.
      </p>
      {message ? (
        <p
          data-testid="gpx-status"
          className={`mt-2 text-sm ${status === "error" ? "text-red-300" : "text-emerald-300"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

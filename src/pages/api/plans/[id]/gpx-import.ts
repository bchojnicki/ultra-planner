import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { updatePlan } from "@/lib/services/plans";
import { bulkInsertAidStations, deleteAidStationsForPlan } from "@/lib/services/aid-stations";
import { gpxImportSchema } from "@/lib/schemas";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// POST /api/plans/:id/gpx-import — replace-all GPX import. Writes the raw GPX
// totals (the calibration delta's denominator) plus the corrected totals onto the
// plan, then swaps the station set: update plan → delete existing stations →
// insert the projected ones. Supabase has no client transaction, so on a
// mid-sequence failure the user simply re-imports (idempotent).
//
// Ownership flows through RLS: updatePlan's .single() yields PostgREST "no rows"
// (PGRST116 → 404) for a plan the caller doesn't own — so a non-owned import is
// rejected before any stations are touched. The 42501 mapping covers the
// defensive case where a station WITH CHECK rejects an attach.
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const planId = context.params.id;
  if (!planId) return new Response("Missing plan id", { status: 400 });

  const body: unknown = await context.request.json().catch(() => null);
  const parsed = gpxImportSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues }, 400);

  const { stations, ...totals } = parsed.data;

  try {
    const plan = await updatePlan(supabase, planId, totals);
    await deleteAidStationsForPlan(supabase, planId);
    const inserted = await bulkInsertAidStations(supabase, planId, stations);
    return json({ plan, stations: inserted }, 200);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return new Response("Forbidden", { status: 403 });
    if (code === "PGRST116") return new Response("Not found", { status: 404 });
    throw e;
  }
};

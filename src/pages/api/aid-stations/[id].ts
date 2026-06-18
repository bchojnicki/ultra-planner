import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deleteAidStation, updateAidStation } from "@/lib/services/aid-stations";
import { aidStationUpdateSchema } from "@/lib/schemas";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// PATCH /api/aid-stations/:id — edit a station (edit-aid-stations). Ownership flows
// through RLS: updateAidStation uses .single(), so a non-owned/absent id surfaces as
// PostgREST "no rows" (PGRST116 → 404); a WITH CHECK violation maps to 42501 → 403.
export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const id = context.params.id;
  if (!id) return new Response("Missing aid station id", { status: 400 });

  const body: unknown = await context.request.json().catch(() => null);
  const parsed = aidStationUpdateSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues }, 400);

  // Empty patch — nothing to update; treat as a no-op success (mirrors plan PATCH).
  if (Object.keys(parsed.data).length === 0) return json({ ok: true }, 200);

  try {
    const station = await updateAidStation(supabase, id, parsed.data);
    return json(station, 200);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return new Response("Forbidden", { status: 403 });
    if (code === "PGRST116") return new Response("Not found", { status: 404 });
    throw e;
  }
};

// DELETE /api/aid-stations/:id — remove a station. RLS hides rows the caller
// doesn't own, so a delete of a non-owned id is an idempotent no-op (still 204).
export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const id = context.params.id;
  if (!id) return new Response("Missing aid station id", { status: 400 });

  await deleteAidStation(supabase, id);
  return new Response(null, { status: 204 });
};

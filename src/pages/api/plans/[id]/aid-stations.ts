import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAidStation } from "@/lib/services/aid-stations";
import { aidStationCreateSchema } from "@/lib/schemas";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// POST /api/plans/:id/aid-stations — add a station to a plan. Ownership flows
// through the parent-plan RLS subquery: attaching to a plan the caller doesn't
// own is rejected by WITH CHECK (PostgREST code 42501) and maps to 403.
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const planId = context.params.id;
  if (!planId) return new Response("Missing plan id", { status: 400 });

  const body: unknown = await context.request.json().catch(() => null);
  const parsed = aidStationCreateSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues }, 400);

  try {
    const station = await createAidStation(supabase, { plan_id: planId, ...parsed.data });
    return json(station, 201);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return new Response("Forbidden", { status: 403 });
    throw e;
  }
};

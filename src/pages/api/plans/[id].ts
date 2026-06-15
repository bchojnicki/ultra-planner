import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { updatePlan } from "@/lib/services/plans";
import { planUpdateSchema } from "@/lib/schemas";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// PATCH /api/plans/:id — autosave race parameters for one plan. RLS scopes the
// update to the owner; a row the caller doesn't own is hidden (0 rows updated),
// which surfaces as a no-row error from updatePlan and maps to 404.
export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const id = context.params.id;
  if (!id) return new Response("Missing plan id", { status: 400 });

  const body: unknown = await context.request.json().catch(() => null);
  const parsed = planUpdateSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues }, 400);

  // Nothing to update (empty patch) — treat as a no-op success.
  if (Object.keys(parsed.data).length === 0) return json({ ok: true }, 200);

  try {
    const updated = await updatePlan(supabase, id, parsed.data);
    return json({ updated_at: updated.updated_at }, 200);
  } catch (e) {
    // RLS hides non-owned rows, so .single() yields PostgREST "no rows"
    // (PGRST116) → 404. Anything else is a real failure; rethrow so it
    // surfaces as a 500 rather than being masked as "Not found".
    if ((e as { code?: string }).code === "PGRST116") return new Response("Not found", { status: 404 });
    throw e;
  }
};

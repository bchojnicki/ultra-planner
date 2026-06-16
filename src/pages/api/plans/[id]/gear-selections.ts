import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { listGearSelections, upsertGearSelection } from "@/lib/services/gear-selections";
import { gearSelectionUpsertSchema } from "@/lib/schemas";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// GET /api/plans/:id/gear-selections — list a plan's sparse per-stage selections.
// RLS scopes the rows to the owner.
export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const planId = context.params.id;
  if (!planId) return new Response("Missing plan id", { status: 400 });

  const selections = await listGearSelections(supabase, planId);
  return json(selections, 200);
};

// PUT /api/plans/:id/gear-selections — upsert one (gear_item, segment) selection.
// Sparse contract: a body with neither a cap nor a pin deletes the row (200 { deleted: true }).
// Ownership flows through the parent-plan RLS subquery (WITH CHECK → 42501 → 403).
export const PUT: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const planId = context.params.id;
  if (!planId) return new Response("Missing plan id", { status: 400 });

  const body: unknown = await context.request.json().catch(() => null);
  const parsed = gearSelectionUpsertSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues }, 400);

  try {
    const row = await upsertGearSelection(supabase, { plan_id: planId, ...parsed.data });
    if (row === null) return json({ deleted: true }, 200);
    return json(row, 200);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return new Response("Forbidden", { status: 403 });
    throw e;
  }
};

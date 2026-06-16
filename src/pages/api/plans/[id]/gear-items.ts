import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createGearItem, listGearItems } from "@/lib/services/gear-items";
import { gearItemCreateSchema } from "@/lib/schemas";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// GET /api/plans/:id/gear-items — list a plan's gear catalog. RLS scopes the rows
// to the owner; a non-owner sees an empty list.
export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const planId = context.params.id;
  if (!planId) return new Response("Missing plan id", { status: 400 });

  const items = await listGearItems(supabase, planId);
  return json(items, 200);
};

// POST /api/plans/:id/gear-items — add a gear item. Ownership flows through the
// parent-plan RLS subquery: attaching to a plan the caller doesn't own is rejected
// by WITH CHECK (PostgREST code 42501) and maps to 403.
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const planId = context.params.id;
  if (!planId) return new Response("Missing plan id", { status: 400 });

  const body: unknown = await context.request.json().catch(() => null);
  const parsed = gearItemCreateSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues }, 400);

  try {
    const item = await createGearItem(supabase, { plan_id: planId, ...parsed.data });
    return json(item, 201);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return new Response("Forbidden", { status: 403 });
    throw e;
  }
};

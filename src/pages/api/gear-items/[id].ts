import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deleteGearItem, updateGearItem } from "@/lib/services/gear-items";
import { gearItemUpdateSchema } from "@/lib/schemas";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// PATCH /api/gear-items/:id — autosave one gear item's fields. RLS scopes the update
// to the owner; a row the caller doesn't own is hidden (0 rows updated), surfacing as
// PostgREST "no rows" (PGRST116) → 404.
export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const id = context.params.id;
  if (!id) return new Response("Missing gear item id", { status: 400 });

  const body: unknown = await context.request.json().catch(() => null);
  const parsed = gearItemUpdateSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues }, 400);

  // Nothing to update (empty patch) — treat as a no-op success.
  if (Object.keys(parsed.data).length === 0) return json({ ok: true }, 200);

  try {
    const updated = await updateGearItem(supabase, id, parsed.data);
    return json({ updated_at: updated.updated_at }, 200);
  } catch (e) {
    if ((e as { code?: string }).code === "PGRST116") return new Response("Not found", { status: 404 });
    throw e;
  }
};

// DELETE /api/gear-items/:id — remove a gear item (cascades to its selections). RLS
// hides rows the caller doesn't own, so a delete of a non-owned id is an idempotent no-op.
export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const id = context.params.id;
  if (!id) return new Response("Missing gear item id", { status: 400 });

  await deleteGearItem(supabase, id);
  return new Response(null, { status: 204 });
};

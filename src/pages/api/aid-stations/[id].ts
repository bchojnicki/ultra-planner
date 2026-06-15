import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deleteAidStation } from "@/lib/services/aid-stations";

export const prerender = false;

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

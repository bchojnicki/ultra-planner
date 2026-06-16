import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createDraftPlan } from "@/lib/services/plans";

export const prerender = false;

// POST /api/plans — create a draft plan and send the runner into the editor.
// Classic form-POST (mirrors /api/auth/signout): the dashboard "New plan" button
// submits here and we redirect to the per-plan URL.
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });

  const plan = await createDraftPlan(supabase, user.id);
  return context.redirect(`/plans/${plan.id}/edit`);
};

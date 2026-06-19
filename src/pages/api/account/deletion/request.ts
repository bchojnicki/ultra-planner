import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { hasActiveDeletionToken } from "@/lib/services/account-deletion";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// POST /api/account/deletion/request — step 1 of the email-confirmed deletion flow
// (account-deletion). Re-authenticates the logged-in user by sending a fresh OTP code
// to their email; the code is verified at /api/account/deletion/verify, which then
// issues the single-use confirmation link. No body — the user is the session user.
//
// Throttle: one live (unused, unexpired) deletion token per user. A second request
// while a token is outstanding returns 429 instead of emailing another code.
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!user.email) return json({ error: "Account has no email on file." }, 400);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });
  const admin = createAdminClient();
  if (!admin) return new Response("Admin client is not configured", { status: 500 });

  // Per-user throttle (DB-based; see hasActiveDeletionToken).
  if (await hasActiveDeletionToken(admin, user.id)) {
    return json({ error: "A deletion request is already in progress. Check your email." }, 429);
  }

  // Re-auth: send a fresh OTP. shouldCreateUser:false — this is an existing account.
  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false },
  });

  if (error) {
    // Supabase's own email rate limit (email_sent caps OTPs/hr) → surface as 429.
    if (error.status === 429 || /rate|too many|seconds/i.test(error.message)) {
      return json({ error: "Please wait a moment before requesting another code." }, 429);
    }
    return json({ error: "Couldn't send a confirmation code. Please try again." }, 502);
  }

  return json({ ok: true }, 200);
};

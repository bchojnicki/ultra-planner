import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { accountDeletionVerifySchema } from "@/lib/schemas";
import { clientIpFrom, issueDeletionToken } from "@/lib/services/account-deletion";
import { sendDeletionConfirmationEmail } from "@/lib/services/email";

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// POST /api/account/deletion/verify — step 2 (account-deletion). Verifies the OTP
// re-auth code, then mints a single-use deletion token (hash stored, 30-min expiry)
// and emails the confirmation link via Resend. The raw token lives only in the email.
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!user.email) return json({ error: "Account has no email on file." }, 400);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase is not configured", { status: 500 });
  const admin = createAdminClient();
  if (!admin) return new Response("Admin client is not configured", { status: 500 });

  const body: unknown = await context.request.json().catch(() => null);
  const parsed = accountDeletionVerifySchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues }, 400);

  // Re-auth gate: the OTP code must verify before we issue a deletion token.
  const { error: otpError } = await supabase.auth.verifyOtp({
    email: user.email,
    token: parsed.data.code,
    type: "email",
  });
  if (otpError) {
    return json({ error: "That code is invalid or expired. Request a new one." }, 400);
  }

  // Mint + persist the token (hash only), then email the raw confirm link.
  const rawToken = await issueDeletionToken(admin, user.id, clientIpFrom(context.request.headers));
  const confirmUrl = new URL(
    `/account/delete/confirm?token=${encodeURIComponent(rawToken)}`,
    context.url.origin,
  ).toString();

  const sent = await sendDeletionConfirmationEmail({ to: user.email, confirmUrl });
  if (!sent.ok) {
    return json({ error: "Couldn't send the confirmation email. Please try again." }, 502);
  }

  return json({ ok: true }, 200);
};

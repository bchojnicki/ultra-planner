import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

// POST /api/auth/verify-code — verify the 6-digit code and establish the session
// (email-otp-auth / S-06). verifyOtp with type "email" matches signInWithOtp email
// codes; on success the SSR client sets the session cookie, so this must run
// server-side. On failure we redirect back to the verify step with the email kept.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = ((form.get("email") as string | null) ?? "").trim();
  const token = ((form.get("token") as string | null) ?? "").trim();

  const verifyStep = (msg: string) =>
    `/auth/signin?step=verify&email=${encodeURIComponent(email)}&error=${encodeURIComponent(msg)}`;

  if (!email || !token) {
    return context.redirect(verifyStep("Enter the 6-digit code from your email."));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return context.redirect(verifyStep("Supabase is not configured"));

  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error) {
    return context.redirect(verifyStep("That code is invalid or expired. Request a new one."));
  }

  return context.redirect("/dashboard");
};

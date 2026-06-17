import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

// POST /api/auth/request-code — email a 6-digit one-time code (email-otp-auth / S-06).
// signInWithOtp creates the user on first use (shouldCreateUser), so sign-up and
// sign-in share this one flow. For a valid-format email we always advance to the
// verify step regardless of whether the address is registered (privacy: never
// reveal account existence). Classic form-POST, mirroring the old signin.ts shape.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = ((form.get("email") as string | null) ?? "").trim();

  const verifyUrl = `/auth/signin?step=verify&email=${encodeURIComponent(email)}`;
  const emailStep = (msg: string) => `/auth/signin?error=${encodeURIComponent(msg)}`;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return context.redirect(emailStep("Enter a valid email address"));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return context.redirect(emailStep("Supabase is not configured"));

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (error) {
    // Rate limit (too many requests) → friendly message; stay on the email step.
    if (error.status === 429 || /rate|too many|seconds/i.test(error.message)) {
      return context.redirect(emailStep("Please wait a moment before requesting another code."));
    }
    // Any other send failure: surface generically without leaking specifics.
    return context.redirect(emailStep("Couldn't send a code. Please try again."));
  }

  // Success — advance to the code-entry step (privacy: same path for new/existing emails).
  return context.redirect(verifyUrl);
};

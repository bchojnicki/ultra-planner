import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { clientIpFrom, consumeDeletionToken, recordDeletionEvent, sha256Hex } from "@/lib/services/account-deletion";

export const prerender = false;

// POST /api/account/deletion/execute — step 3, the irreversible delete (account-deletion).
// The token IS the credential: this endpoint does NOT require a session (the link may be
// opened on a different device than the one logged in). Submitted as a form POST from the
// confirm page.
//
// Order is deliberate: atomically consume (burn) the token → write audit row → HARD delete
// the auth user (cascades all data) → clear the local session. The consume is the sole
// single-use gate (a compare-and-set that closes the old read-then-burn race); the audit
// row is still written before the delete so a mid-operation failure leaves a trace.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => null);
  const token = ((form?.get("token") as string | null) ?? "").trim();

  const admin = createAdminClient();
  if (!admin) return new Response("Admin client is not configured", { status: 500 });

  // Invalid / expired / already-used → bounce back to the confirm page, which renders the
  // correct non-destructive message. Idempotent and CSRF-safe (the token is the secret).
  if (!token) return context.redirect("/account/delete/confirm");

  try {
    // Atomic single-use gate: burn the token and return its row, or null if it was already
    // used / expired / invalid. A losing concurrent caller gets null here and bounces before
    // writing any audit row, so exactly one execution proceeds to the delete.
    const row = await consumeDeletionToken(admin, token);
    if (!row) {
      return context.redirect(`/account/delete/confirm?token=${encodeURIComponent(token)}`);
    }

    // Need the email to hash for the audit row; fetch it before the user is gone. If the
    // lookup errors, fall back to an empty hash rather than failing the deletion — the audit
    // row is best-effort and keyed by user_id; deletion correctness does not depend on email.
    const { data: userData, error: lookupError } = await admin.auth.admin.getUserById(row.user_id);
    const email = lookupError ? "" : (userData.user.email ?? "");
    const emailHash = await sha256Hex(email.trim().toLowerCase());

    await recordDeletionEvent(admin, {
      userId: row.user_id,
      emailHash,
      requestedIp: clientIpFrom(context.request.headers),
    });

    const { error: delError } = await admin.auth.admin.deleteUser(row.user_id);
    if (delError) {
      // The token is already burned; surface a generic failure. The audit row records the attempt.
      return new Response("Account deletion failed. Please try again.", { status: 500 });
    }
  } catch {
    // Transient Supabase/DB error from a service call — surface a generic failure rather than
    // a raw 500 (mirrors the error-mapping discipline in aid-stations/[id].ts).
    return new Response("Account deletion failed. Please try again.", { status: 500 });
  }

  // Clear the local session if this same browser was logged in (no-op on another device).
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) await supabase.auth.signOut();

  return context.redirect("/account/delete/done");
};

// Transactional email via Resend's HTTP API. Supabase's built-in auth emails can only
// carry the fixed auth-template links, so the custom account-deletion confirmation link
// is sent here instead. Uses plain fetch (no SDK) so it runs on the Cloudflare Workers
// runtime with no Node dependencies.
//
// RESEND_FROM_EMAIL must be a verified sender/domain in the Resend dashboard — until the
// domain is verified, sends fail and surface as an error result (never throws).
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from "astro:env/server";

// Discriminated result so callers map a send failure to a 5xx rather than crashing the
// request. `error` is a short, log-safe reason (never the raw API key).
export type EmailResult = { ok: true } | { ok: false; error: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendDeletionConfirmationEmail({
  to,
  confirmUrl,
}: {
  to: string;
  confirmUrl: string;
}): Promise<EmailResult> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return { ok: false, error: "email_not_configured" };
  }

  const html = `
    <p>You asked to permanently delete your Ultra Planner account.</p>
    <p>This removes your account and <strong>all</strong> of your plans, aid stations, and gear — it cannot be undone.</p>
    <p><a href="${confirmUrl}">Confirm account deletion</a></p>
    <p>This link can be used once and expires in 30 minutes. If you didn't request this, ignore this email — nothing will be deleted.</p>
  `;

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to,
        subject: "Confirm your Ultra Planner account deletion",
        html,
      }),
    });
  } catch (err) {
    return { ok: false, error: `resend_network_error: ${String(err).slice(0, 200)}` };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `resend_${res.status}: ${detail.slice(0, 200)}` };
  }

  return { ok: true };
}

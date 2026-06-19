// Account-deletion token service (account-deletion). All access to the
// account_deletion_tokens table goes through the service-role admin client
// (RLS denies authenticated/anon entirely). Runs on the Cloudflare Workers
// runtime using Web Crypto globals (crypto.getRandomValues / crypto.subtle).
//
// Security model: a high-entropy raw token is emailed to the user; only its
// SHA-256 hash is persisted. The raw value never touches the database, so a DB
// read can't reconstruct a usable link. Tokens are single-use (used_at) and
// short-lived (TOKEN_TTL_MINUTES).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";

type Admin = SupabaseClient<Database>;

// Confirmation links expire 30 minutes after issuance (decision: tight blast
// radius if a link leaks). The same window doubles as the per-user request
// throttle — an unused, unexpired token blocks a second request.
export const TOKEN_TTL_MINUTES = 30;

// 32 bytes of CSPRNG entropy, hex-encoded → a 64-char URL-safe token.
export function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// SHA-256 → lowercase hex. Used for both the token hash and the audit email_hash.
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// True if the user already has an unused, unexpired deletion token — used to
// throttle the request endpoint (one live token per user at a time).
export async function hasActiveDeletionToken(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("account_deletion_tokens")
    .select("token_hash")
    .eq("user_id", userId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

// Mint a single-use token: persist its hash + expiry (+ requesting IP) and
// return the RAW token to be emailed. Caller builds the confirm URL from it.
export async function issueDeletionToken(admin: Admin, userId: string, requestedIp: string | null): Promise<string> {
  const raw = generateRawToken();
  const tokenHash = await sha256Hex(raw);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString();

  const { error } = await admin.from("account_deletion_tokens").insert({
    token_hash: tokenHash,
    user_id: userId,
    expires_at: expiresAt,
    requested_ip: requestedIp,
  });
  if (error) throw error;

  return raw;
}

// Best-effort client IP from Cloudflare's header, falling back to XFF. Stored
// only for audit/abuse forensics; null when unavailable.
export function clientIpFrom(headers: Headers): string | null {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

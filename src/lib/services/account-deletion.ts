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
import type { AccountDeletionToken, Database } from "@/types";

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

// Look up the live token row for a raw token: matches the stored hash, still
// unused, not expired. Returns null otherwise. Used by both the confirm page
// (read-only state check) and the execute endpoint (consumption).
export async function findValidDeletionToken(admin: Admin, rawToken: string): Promise<AccountDeletionToken | null> {
  const tokenHash = await sha256Hex(rawToken);
  const { data, error } = await admin
    .from("account_deletion_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Mark a token consumed. Non-atomic (no `used_at IS NULL` guard) — retained as a
// lower-level helper for tests that isolate the used_at read gate. NOT on the
// production consume path; the execute endpoint uses consumeDeletionToken instead.
export async function markTokenUsed(admin: Admin, tokenHash: string): Promise<void> {
  const { error } = await admin
    .from("account_deletion_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);
  if (error) throw error;
}

// Atomically consume a token: the single-use gate. This is a compare-and-set —
// one conditional UPDATE takes the row lock and, via Postgres's EvalPlanQual
// re-check, re-evaluates its WHERE against the winner's committed row, so of two
// concurrent consumes of the same token EXACTLY ONE gets a row back and the loser
// matches zero rows (returns null). The `used_at IS NULL` predicate is the
// load-bearing single-use guard; `expires_at > now()` folds the validity check
// into the same atomic step so an expired token can never be consumed. Race-free
// under READ COMMITTED without an explicit transaction. Returns the burned row
// (with user_id) on win, null on loss / already-used / expired / absent.
export async function consumeDeletionToken(admin: Admin, rawToken: string): Promise<AccountDeletionToken | null> {
  const tokenHash = await sha256Hex(rawToken);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("account_deletion_tokens")
    .update({ used_at: now })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Write the cascade-surviving audit row (account_deletion_events has no FK to
// auth.users). email_hash keeps PII out of the trail. Written BEFORE the delete
// so a mid-operation failure still leaves a trace.
export async function recordDeletionEvent(
  admin: Admin,
  params: { userId: string; emailHash: string; requestedIp: string | null },
): Promise<void> {
  const { error } = await admin.from("account_deletion_events").insert({
    user_id: params.userId,
    email_hash: params.emailHash,
    requested_ip: params.requestedIp,
  });
  if (error) throw error;
}

// Best-effort client IP from Cloudflare's header, falling back to XFF. Stored
// only for audit/abuse forensics; null when unavailable.
export function clientIpFrom(headers: Headers): string | null {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

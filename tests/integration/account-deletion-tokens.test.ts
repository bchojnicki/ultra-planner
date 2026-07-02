// Account-deletion token service integration test (account-deletion, Phase 2).
//
// Covers the runnable core of the request/verify endpoints against local Supabase:
//   - issueDeletionToken persists exactly ONE row, storing the SHA-256 HASH (never the
//     raw token), with a ~30-minute expiry, null used_at, and the requesting IP.
//   - hasActiveDeletionToken is the per-user throttle predicate the request endpoint
//     uses to return 429 — false before issuance, true while a live token exists.
//
// The endpoint-level guards (401 unauthenticated, 400 on a bad OTP code) are HTTP/auth
// behaviors verified manually (plan items 2.4/2.5) and in the Playwright suite — the
// endpoints import astro:env/server and so can't be imported under Vitest.
//
// PREREQUISITES — LOCAL Supabase only (see account-deletion-cascade.test.ts header).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/types";
import {
  TOKEN_TTL_MINUTES,
  findValidDeletionToken,
  hasActiveDeletionToken,
  issueDeletionToken,
  sha256Hex,
} from "../../src/lib/services/account-deletion";

const DEFAULT_URL = "http://127.0.0.1:54321";
const DEFAULT_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SUPABASE_URL = process.env.SUPABASE_URL ?? DEFAULT_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;

function assertLocal(url: string): void {
  if (process.env.ALLOW_REMOTE_DELETION_TEST === "1") return;
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run against non-local SUPABASE_URL "${url}". Point at local Supabase.`);
  }
}

type Client = SupabaseClient<Database>;

const admin: Client = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `account-deletion-token-${Date.now()}@example.com`;
let userId = "";

describe("account deletion token service", () => {
  beforeAll(async () => {
    assertLocal(SUPABASE_URL);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "test-password-123!",
      email_confirm: true,
    });
    if (error ?? !data.user) throw error ?? new Error("failed to create user");
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("no active token before issuance", async () => {
    expect(await hasActiveDeletionToken(admin, userId)).toBe(false);
  });

  it("issueDeletionToken stores exactly one hashed, ~30-min, unused row", async () => {
    const before = Date.now();
    const raw = await issueDeletionToken(admin, userId, "203.0.113.7");

    // Raw token is 64 hex chars (32 bytes).
    expect(raw).toMatch(/^[0-9a-f]{64}$/);

    const { data: rows, error } = await admin.from("account_deletion_tokens").select("*").eq("user_id", userId);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);

    const row = rows?.[0];
    if (!row) throw new Error("expected one token row");
    // Stored value is the HASH, not the raw token.
    expect(row.token_hash).not.toBe(raw);
    expect(row.token_hash).toBe(await sha256Hex(raw));
    expect(row.used_at).toBeNull();
    expect(row.requested_ip).toBe("203.0.113.7");

    // Expiry is ~TOKEN_TTL_MINUTES out (allow a generous ±2 min for clock/exec slack).
    const ttlMs = new Date(row.expires_at).getTime() - before;
    expect(ttlMs).toBeGreaterThan((TOKEN_TTL_MINUTES - 2) * 60_000);
    expect(ttlMs).toBeLessThan((TOKEN_TTL_MINUTES + 2) * 60_000);
  });

  it("hasActiveDeletionToken is true while a live token exists (throttle → 429)", async () => {
    expect(await hasActiveDeletionToken(admin, userId)).toBe(true);
  });

  it("a used token no longer counts as active", async () => {
    const { error } = await admin
      .from("account_deletion_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", userId);
    expect(error).toBeNull();
    expect(await hasActiveDeletionToken(admin, userId)).toBe(false);
  });
});

// Phase 3 (Risk #3, research gap 1): expiry enforcement on the CONSUME path.
// Nothing today back-dates expires_at and asserts findValidDeletionToken rejects —
// the "used after expiry" concern was untested. Isolated user so it can't collide
// with the ordered throttle tests above.
describe("account deletion token consume-path expiry gate", () => {
  const expEmail = `account-deletion-expiry-${Date.now()}@example.com`;
  let expUserId = "";

  beforeAll(async () => {
    assertLocal(SUPABASE_URL);
    const { data, error } = await admin.auth.admin.createUser({
      email: expEmail,
      password: "test-password-123!",
      email_confirm: true,
    });
    if (error ?? !data.user) throw error ?? new Error("failed to create user");
    expUserId = data.user.id;
  });

  afterAll(async () => {
    if (expUserId) await admin.auth.admin.deleteUser(expUserId);
  });

  // Independent oracle: the `.gt("expires_at", now)` gate contract in
  // findValidDeletionToken — NOT the function's own output. Issue a live token,
  // confirm it resolves, back-date expires_at into the past, assert it no longer
  // resolves. Fails if the expiry predicate is removed from the read gate.
  it("findValidDeletionToken rejects a token whose expires_at is in the past", async () => {
    const raw = await issueDeletionToken(admin, expUserId, "203.0.113.11");

    // Sanity: the live token resolves before we back-date it.
    expect(await findValidDeletionToken(admin, raw)).not.toBeNull();

    const past = new Date(Date.now() - 60_000).toISOString();
    const { error } = await admin.from("account_deletion_tokens").update({ expires_at: past }).eq("user_id", expUserId);
    expect(error).toBeNull();

    // Expiry enforced at consume time.
    expect(await findValidDeletionToken(admin, raw)).toBeNull();
  });
});

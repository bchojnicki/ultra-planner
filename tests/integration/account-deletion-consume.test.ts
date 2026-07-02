// Account-deletion atomic-consume integration test (fix-account-deletion-token-toctou).
//
// Proves the single-use guarantee of consumeDeletionToken — the compare-and-set that
// replaced the old read-then-burn race on the execute path:
//   - Sequential: consuming the same raw token twice burns it exactly once; the second
//     consume is rejected BY THE used_at GUARD (row still present, used_at unchanged), not
//     by the row being gone — the confound the Phase-3 isolated single-use test called out.
//   - Concurrent: two consumes fired together yield EXACTLY ONE winner (Postgres row-lock +
//     EvalPlanQual re-check). Deterministic after the fix, so not flaky.
//
// PREREQUISITES — LOCAL Supabase only (see account-deletion-cascade.test.ts header).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/types";
import {
  consumeDeletionToken,
  findValidDeletionToken,
  issueDeletionToken,
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

describe("account deletion atomic consume — sequential single-use", () => {
  const email = `account-deletion-consume-seq-${Date.now()}@example.com`;
  let userId = "";

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

  it("consumes exactly once; the second consume is rejected by the used_at guard", async () => {
    const raw = await issueDeletionToken(admin, userId, "203.0.113.20");

    // Read path (confirm page) still resolves the live token.
    expect(await findValidDeletionToken(admin, raw)).not.toBeNull();

    // First consume WINS: returns the burned row.
    const first = await consumeDeletionToken(admin, raw);
    expect(first).not.toBeNull();
    expect(first?.user_id).toBe(userId);
    expect(first?.used_at).not.toBeNull();
    const burnedAt = first?.used_at;

    // Second consume of the SAME raw token LOSES: rejected by the compare-and-set.
    const second = await consumeDeletionToken(admin, raw);
    expect(second).toBeNull();

    // Rejection is provably the used_at guard, NOT row-absence: the row is still there and
    // its used_at was NOT overwritten (a non-atomic burn would move the timestamp).
    const { data: rows } = await admin.from("account_deletion_tokens").select("used_at").eq("user_id", userId);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.used_at).not.toBeNull();
    expect(rows?.[0]?.used_at).toBe(burnedAt);

    // Read gate agrees the token is spent; the user is untouched (no cascade confound).
    expect(await findValidDeletionToken(admin, raw)).toBeNull();
    const { data: gotUser } = await admin.auth.admin.getUserById(userId);
    expect(gotUser.user?.id).toBe(userId);
  });
});

describe("account deletion atomic consume — concurrent one-winner", () => {
  const email = `account-deletion-consume-conc-${Date.now()}@example.com`;
  let userId = "";

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

  it("two concurrent consumes of the same token yield exactly one winner", async () => {
    const raw = await issueDeletionToken(admin, userId, "203.0.113.21");

    // Fire both consumes together; Postgres guarantees exactly one wins the row lock.
    const results = await Promise.all([consumeDeletionToken(admin, raw), consumeDeletionToken(admin, raw)]);

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.user_id).toBe(userId);

    // The token was burned exactly once.
    const { data: rows } = await admin.from("account_deletion_tokens").select("used_at").eq("user_id", userId);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.used_at).not.toBeNull();
  });
});

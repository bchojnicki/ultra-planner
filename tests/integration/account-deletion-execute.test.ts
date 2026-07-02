// Account-deletion execute-flow integration test (account-deletion, Phase 3).
//
// Exercises the exact service sequence the execute endpoint runs, against local Supabase:
//   seed user + plan + aid_station + gear_item
//   → issueDeletionToken → findValidDeletionToken (valid)
//   → recordDeletionEvent → markTokenUsed → admin.deleteUser (HARD)
//   → assert: auth user gone, all data cascade-removed, ONE surviving audit row, token
//     unusable on replay.
//
// The HTTP wiring (form parse, redirects to the confirm page, session clear) is verified
// manually (plan items 3.4-3.6) — the endpoint imports astro:env/server.
//
// PREREQUISITES — LOCAL Supabase only (see account-deletion-cascade.test.ts header).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/types";
import {
  findValidDeletionToken,
  issueDeletionToken,
  markTokenUsed,
  recordDeletionEvent,
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

const email = `account-deletion-exec-${Date.now()}@example.com`;
let userId = "";
let planId = "";

function planFor(uid: string) {
  return {
    user_id: uid,
    name: "Execute flow plan",
    total_distance_km: 100,
    total_elevation_gain_m: 3000,
    total_elevation_loss_m: 3000,
    start_time: new Date("2026-09-01T06:00:00Z").toISOString(),
    total_expected_minutes: 900,
    hourly_fluid_ml: 500,
    hourly_carb_g: 60,
    hourly_sodium_mg: 700,
  };
}

describe("account deletion execute flow", () => {
  beforeAll(async () => {
    assertLocal(SUPABASE_URL);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "test-password-123!",
      email_confirm: true,
    });
    if (error ?? !data.user) throw error ?? new Error("failed to create user");
    userId = data.user.id;

    const { data: plan, error: planErr } = await admin.from("plans").insert(planFor(userId)).select().single();
    if (planErr) throw planErr;
    planId = plan.id;

    const { error: stationErr } = await admin
      .from("aid_stations")
      .insert({ plan_id: planId, cumulative_distance_km: 50, cumulative_elevation_gain_m: 1500 });
    if (stationErr) throw stationErr;
    const { error: gearErr } = await admin
      .from("gear_items")
      .insert({ plan_id: planId, kind: "gel", name: "Test gel", carb_g: 25 });
    if (gearErr) throw gearErr;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("consumes a valid token, hard-deletes, cascades, and writes a surviving audit row", async () => {
    const raw = await issueDeletionToken(admin, userId, "203.0.113.9");

    // Token resolves while live.
    const row = await findValidDeletionToken(admin, raw);
    if (!row) throw new Error("expected a valid token row");

    // The execute sequence (audit before delete, mark-used before delete, then delete).
    const emailHash = await sha256Hex(email.toLowerCase());
    await recordDeletionEvent(admin, { userId, emailHash, requestedIp: "203.0.113.9" });
    await markTokenUsed(admin, row.token_hash);
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    expect(delErr).toBeNull();

    // Auth user gone.
    const { data: gotUser } = await admin.auth.admin.getUserById(userId);
    expect(gotUser.user).toBeNull();

    // Cascade: all connected data removed.
    expect((await admin.from("plans").select("id").eq("user_id", userId)).data).toEqual([]);
    expect((await admin.from("aid_stations").select("id").eq("plan_id", planId)).data).toEqual([]);
    expect((await admin.from("gear_items").select("id").eq("plan_id", planId)).data).toEqual([]);

    // Audit row SURVIVES the cascade (no FK to auth.users) and matches the email hash.
    const events = await admin.from("account_deletion_events").select("*").eq("user_id", userId);
    expect(events.data).toHaveLength(1);
    expect(events.data?.[0]?.email_hash).toBe(emailHash);

    // Replay: the raw token no longer resolves (used + cascade-removed).
    expect(await findValidDeletionToken(admin, raw)).toBeNull();

    userId = ""; // already deleted; skip afterAll cleanup

    // Audit cleanup (the row has no FK so it won't auto-delete).
    await admin.from("account_deletion_events").delete().eq("email_hash", emailHash);
  });
});

// Phase 3 (Risk #3, research gap 2): single-use enforced by used_at ALONE.
// The execute test above proves replay-null only AFTER markTokenUsed AND the
// cascade delete, so it can't distinguish the used_at guard from the row simply
// being gone. Here we burn the token WITHOUT deleting the user, isolating the
// guard, and add a one-line actor-binding proof that user B is untouched.
describe("account deletion single-use isolation (consume path)", () => {
  const emailA = `account-deletion-singleuse-a-${Date.now()}@example.com`;
  const emailB = `account-deletion-singleuse-b-${Date.now()}@example.com`;
  let userIdA = "";
  let userIdB = "";

  beforeAll(async () => {
    assertLocal(SUPABASE_URL);
    const { data: a, error: ea } = await admin.auth.admin.createUser({
      email: emailA,
      password: "test-password-123!",
      email_confirm: true,
    });
    if (ea ?? !a.user) throw ea ?? new Error("failed to create user A");
    userIdA = a.user.id;

    const { data: b, error: eb } = await admin.auth.admin.createUser({
      email: emailB,
      password: "test-password-123!",
      email_confirm: true,
    });
    if (eb ?? !b.user) throw eb ?? new Error("failed to create user B");
    userIdB = b.user.id;
  });

  afterAll(async () => {
    if (userIdA) await admin.auth.admin.deleteUser(userIdA);
    if (userIdB) await admin.auth.admin.deleteUser(userIdB);
  });

  it("markTokenUsed alone burns the token; user B is untouched", async () => {
    const raw = await issueDeletionToken(admin, userIdA, "203.0.113.12");
    const row = await findValidDeletionToken(admin, raw);
    if (!row) throw new Error("expected a valid token row");

    // Burn the token via the used_at guard only — no deleteUser, no cascade.
    await markTokenUsed(admin, row.token_hash);

    // Single-use enforced by used_at alone: the read gate now rejects.
    expect(await findValidDeletionToken(admin, raw)).toBeNull();

    // User A is still present — this is what isolates the used_at guard from the
    // cascade confound in the destructive test above.
    const { data: gotA } = await admin.auth.admin.getUserById(userIdA);
    expect(gotA.user?.id).toBe(userIdA);

    // The token row itself still exists (marked used, not deleted).
    const { data: rows } = await admin.from("account_deletion_tokens").select("used_at").eq("user_id", userIdA);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.used_at).not.toBeNull();

    // Actor-binding (research: structural — the token names its own user_id).
    // Defense-in-depth one-liner: consuming A's token leaves user B untouched.
    const { data: gotB } = await admin.auth.admin.getUserById(userIdB);
    expect(gotB.user?.id).toBe(userIdB);
  });
});

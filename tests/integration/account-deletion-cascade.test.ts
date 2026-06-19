// Account-deletion cascade integration test (account-deletion, Phase 1).
//
// Proves the load-bearing assumption of the whole feature: a service-role HARD
// delete of the auth.users row (supabase.auth.admin.deleteUser, the default
// shouldSoftDelete=false) cascades through the existing FKs and removes ALL of the
// user's connected data — plans, aid_stations, gear_items — leaving nothing behind.
//
// PREREQUISITES — run against LOCAL Supabase only:
//   1. Docker running, then `npx supabase start`
//   2. Migrations applied: `npx supabase db reset`
//   3. `npx vitest run tests/integration/account-deletion-cascade.test.ts`
//      (or `npm run test:integration`)
//
// ENV (all optional — default to the Supabase CLI's well-known local dev keys):
//   SUPABASE_URL              local API url        (default http://127.0.0.1:54321)
//   SUPABASE_SERVICE_ROLE_KEY service role key     (default local demo service JWT)
//   ALLOW_REMOTE_DELETION_TEST=1  bypass the localhost guard (NOT recommended)
//
// SAFETY: the test CREATES and DELETES a user. It refuses to run against a non-local
// SUPABASE_URL unless ALLOW_REMOTE_DELETION_TEST=1.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/types";

const DEFAULT_URL = "http://127.0.0.1:54321";
const DEFAULT_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SUPABASE_URL = process.env.SUPABASE_URL ?? DEFAULT_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;

function assertLocal(url: string): void {
  if (process.env.ALLOW_REMOTE_DELETION_TEST === "1") return;
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `Refusing to run the account-deletion test against non-local SUPABASE_URL "${url}". ` +
        `This test creates and deletes a user. Point SUPABASE_URL at local Supabase ` +
        `(${DEFAULT_URL}) or set ALLOW_REMOTE_DELETION_TEST=1 to override.`,
    );
  }
}

type Client = SupabaseClient<Database>;

const admin: Client = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `account-deletion-${Date.now()}@example.com`;
let userId = "";
let planId = "";

function planFor(uid: string) {
  return {
    user_id: uid,
    name: "Deletion cascade plan",
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

describe("account deletion cascade", () => {
  beforeAll(async () => {
    assertLocal(SUPABASE_URL);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "test-password-123!",
      email_confirm: true,
    });
    if (error ?? !data.user) throw error ?? new Error("failed to create user");
    userId = data.user.id;

    // Seed a full ownership chain: plan -> aid_station + gear_item.
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
    // Idempotent safety net: if the assertion failed before the delete ran, clean up.
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("hard-deleting the auth user removes the user and cascades all connected data", async () => {
    // Sanity: the chain exists before deletion.
    const before = await admin.from("plans").select("id").eq("user_id", userId);
    expect(before.error).toBeNull();
    expect(before.data).toHaveLength(1);

    // HARD delete (default shouldSoftDelete=false) — this is what the execute endpoint runs.
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    expect(delErr).toBeNull();

    // The auth user is gone.
    const { data: gotUser } = await admin.auth.admin.getUserById(userId);
    expect(gotUser.user).toBeNull();

    // Cascade: no plans, aid_stations, or gear_items remain for this user/plan.
    const plansAfter = await admin.from("plans").select("id").eq("user_id", userId);
    expect(plansAfter.error).toBeNull();
    expect(plansAfter.data).toEqual([]);

    const stationsAfter = await admin.from("aid_stations").select("id").eq("plan_id", planId);
    expect(stationsAfter.error).toBeNull();
    expect(stationsAfter.data).toEqual([]);

    const gearAfter = await admin.from("gear_items").select("id").eq("plan_id", planId);
    expect(gearAfter.error).toBeNull();
    expect(gearAfter.data).toEqual([]);

    userId = ""; // already deleted; skip afterAll cleanup
  });
});

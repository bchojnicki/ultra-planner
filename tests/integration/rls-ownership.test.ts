// RLS owner-isolation integration test (F-01 / plan-data-and-ownership, Phase 3).
//
// Proves that the Row-Level Security policies in
// supabase/migrations/20260603132423_create_plans_and_aid_stations.sql enforce
// per-user ownership: runner B can never read, update, delete, or attach rows to
// runner A's plan, while runner A can fully CRUD its own data.
//
// PREREQUISITES — run against LOCAL Supabase only:
//   1. Docker running, then `npx supabase start`
//   2. Migration applied: `npx supabase db reset`
//   3. `npx vitest run tests/integration/rls-ownership.test.ts`
//      (or `npm run test:integration`)
//
// ENV (all optional — default to the Supabase CLI's well-known local dev keys):
//   SUPABASE_URL              local API url        (default http://127.0.0.1:54321)
//   SUPABASE_ANON_KEY         anon/publishable key (default local demo anon JWT)
//   SUPABASE_SERVICE_ROLE_KEY service role key     (default local demo service JWT)
//   ALLOW_REMOTE_RLS_TEST=1   bypass the localhost guard (NOT recommended)
//
// SAFETY: the test CREATES and DELETES users. It refuses to run against a
// non-local SUPABASE_URL unless ALLOW_REMOTE_RLS_TEST=1, so it can never mutate
// the remote project configured in .env / .dev.vars by accident.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/types";

// Supabase CLI default local dev credentials (stable across installs).
const DEFAULT_URL = "http://127.0.0.1:54321";
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const DEFAULT_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SUPABASE_URL = process.env.SUPABASE_URL ?? DEFAULT_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? DEFAULT_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;

function assertLocal(url: string): void {
  if (process.env.ALLOW_REMOTE_RLS_TEST === "1") return;
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `Refusing to run the RLS test against non-local SUPABASE_URL "${url}". ` +
        `This test creates and deletes users. Point SUPABASE_URL at local Supabase ` +
        `(${DEFAULT_URL}) or set ALLOW_REMOTE_RLS_TEST=1 to override.`,
    );
  }
}

type Client = SupabaseClient<Database>;

// One anon-key client per runner; signInWithPassword attaches the session in
// memory so every subsequent query runs as that authenticated user (RLS applies).
function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const PASSWORD = "test-password-123!";
const stamp = Date.now();
const emailA = `rls-owner-a-${stamp}@example.com`;
const emailB = `rls-owner-b-${stamp}@example.com`;

function planFor(userId: string) {
  return {
    user_id: userId,
    name: "Test 100-miler",
    total_distance_km: 161.0,
    total_elevation_gain_m: 6000,
    total_elevation_loss_m: 6000,
    start_time: new Date("2026-09-01T06:00:00Z").toISOString(),
    total_expected_minutes: 1530, // 25:30
    hourly_fluid_ml: 500,
    hourly_carb_g: 60,
    hourly_sodium_mg: 700,
  };
}

const admin: Client = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let userIdA = "";
let userIdB = "";
let clientA: Client;
let clientB: Client;
let planAId = "";
let aidStationAId = "";

describe("RLS owner isolation", () => {
  beforeAll(async () => {
    assertLocal(SUPABASE_URL);

    const { data: createdA, error: errA } = await admin.auth.admin.createUser({
      email: emailA,
      password: PASSWORD,
      email_confirm: true,
    });
    if (errA ?? !createdA.user) throw errA ?? new Error("failed to create user A");
    userIdA = createdA.user.id;

    const { data: createdB, error: errB } = await admin.auth.admin.createUser({
      email: emailB,
      password: PASSWORD,
      email_confirm: true,
    });
    if (errB ?? !createdB.user) throw errB ?? new Error("failed to create user B");
    userIdB = createdB.user.id;

    clientA = anonClient();
    clientB = anonClient();

    const { error: signInA } = await clientA.auth.signInWithPassword({ email: emailA, password: PASSWORD });
    if (signInA) throw signInA;
    const { error: signInB } = await clientB.auth.signInWithPassword({ email: emailB, password: PASSWORD });
    if (signInB) throw signInB;
  });

  afterAll(async () => {
    // Deleting the users cascades to their plans (FK on auth.users ON DELETE
    // CASCADE) and on to aid_stations, so no manual row cleanup is needed.
    if (userIdA) await admin.auth.admin.deleteUser(userIdA);
    if (userIdB) await admin.auth.admin.deleteUser(userIdB);
  });

  it("(a) runner A creates a plan and an aid station", async () => {
    const { data: plan, error: planErr } = await clientA.from("plans").insert(planFor(userIdA)).select().single();
    expect(planErr).toBeNull();
    if (!plan) throw new Error("plan insert returned no row");
    planAId = plan.id;

    const { data: station, error: stationErr } = await clientA
      .from("aid_stations")
      .insert({ plan_id: planAId, cumulative_distance_km: 50, cumulative_elevation_gain_m: 2000 })
      .select()
      .single();
    expect(stationErr).toBeNull();
    if (!station) throw new Error("aid station insert returned no row");
    aidStationAId = station.id;
  });

  it("(b) runner B cannot SELECT runner A's plan", async () => {
    const { data, error } = await clientB.from("plans").select("*").eq("id", planAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("(b) runner B cannot SELECT runner A's aid station", async () => {
    const { data, error } = await clientB.from("aid_stations").select("*").eq("id", aidStationAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("(b) runner B's UPDATE of runner A's aid station affects no rows", async () => {
    const { data, error } = await clientB
      .from("aid_stations")
      .update({ notes: "hijacked" })
      .eq("id", aidStationAId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // Confirm A's aid station is untouched.
    const { data: stillMine } = await clientA.from("aid_stations").select("notes").eq("id", aidStationAId).single();
    expect(stillMine?.notes).toBeNull();
  });

  it("(b) runner B's DELETE of runner A's aid station affects no rows", async () => {
    const { data, error } = await clientB.from("aid_stations").delete().eq("id", aidStationAId).select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // A's aid station still exists.
    const { data: stillThere } = await clientA.from("aid_stations").select("id").eq("id", aidStationAId).single();
    expect(stillThere?.id).toBe(aidStationAId);
  });

  it("(b) runner B's UPDATE of runner A's plan affects no rows", async () => {
    const { data, error } = await clientB.from("plans").update({ name: "hijacked" }).eq("id", planAId).select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // Confirm A's plan is untouched.
    const { data: stillMine } = await clientA.from("plans").select("name").eq("id", planAId).single();
    expect(stillMine?.name).toBe("Test 100-miler");
  });

  it("(b) runner B's DELETE of runner A's plan affects no rows", async () => {
    const { data, error } = await clientB.from("plans").delete().eq("id", planAId).select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // A's plan still exists.
    const { data: stillThere } = await clientA.from("plans").select("id").eq("id", planAId).single();
    expect(stillThere?.id).toBe(planAId);
  });

  it("(c) runner B cannot INSERT an aid station onto runner A's plan (WITH CHECK)", async () => {
    const { error } = await clientB
      .from("aid_stations")
      .insert({ plan_id: planAId, cumulative_distance_km: 10, cumulative_elevation_gain_m: 100 })
      .select()
      .single();
    expect(error).not.toBeNull();
    // 42501 = insufficient_privilege (RLS WITH CHECK violation).
    expect(error?.code).toBe("42501");
  });

  it("(d) runner A can read its own plan and aid station", async () => {
    const { data: plans, error: plansErr } = await clientA.from("plans").select("*").eq("id", planAId);
    expect(plansErr).toBeNull();
    expect(plans).toHaveLength(1);

    const { data: stations, error: stationsErr } = await clientA
      .from("aid_stations")
      .select("*")
      .eq("plan_id", planAId);
    expect(stationsErr).toBeNull();
    expect(stations).toHaveLength(1);
    expect(stations?.[0]?.id).toBe(aidStationAId);
  });
});

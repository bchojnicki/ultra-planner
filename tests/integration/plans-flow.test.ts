// Backend integration + schema tests for the race-setup slice (S-01, Phase 1).
//
// The API endpoints are thin wrappers over the F-01 services + zod schemas, so
// we test those layers directly (the full HTTP path is covered by the Phase 3
// Playwright e2e). Proves: draft defaults satisfy every NOT-NULL column, the new
// write paths are owner-scoped by RLS, and the schemas accept/reject correctly.
//
// PREREQUISITES — run against LOCAL Supabase only (same as F-01):
//   1. Docker running, then `npx supabase start`
//   2. Migration applied: `npx supabase db reset`
//   3. `npx vitest run tests/integration/plans-flow.test.ts`
//
// ENV defaults to the Supabase CLI's well-known local keys; a localhost guard
// refuses to run against a non-local SUPABASE_URL (see assertLocal).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/types";
import { createAidStation, deleteAidStation, listAidStations } from "../../src/lib/services/aid-stations";
import { createDraftPlan } from "../../src/lib/services/plans";
import { aidStationCreateSchema, planUpdateSchema } from "../../src/lib/schemas";

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
      `Refusing to run against non-local SUPABASE_URL "${url}". This test creates and ` +
        `deletes users. Point SUPABASE_URL at local Supabase (${DEFAULT_URL}) or set ALLOW_REMOTE_RLS_TEST=1.`,
    );
  }
}

type Client = SupabaseClient<Database>;

function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const admin: Client = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "test-password-123!";
const stamp = Date.now();
const emailA = `s01-a-${stamp}@example.com`;
const emailB = `s01-b-${stamp}@example.com`;

describe("plan-update schema", () => {
  it("accepts a valid partial patch", () => {
    const r = planUpdateSchema.safeParse({ name: "My race", total_distance_km: 161, total_expected_minutes: 1530 });
    expect(r.success).toBe(true);
  });

  it("accepts an ISO start_time", () => {
    const r = planUpdateSchema.safeParse({ start_time: new Date("2026-09-01T06:00:00Z").toISOString() });
    expect(r.success).toBe(true);
  });

  it("rejects negative numbers, empty name, bad datetime, unknown keys", () => {
    expect(planUpdateSchema.safeParse({ total_distance_km: -1 }).success).toBe(false);
    expect(planUpdateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(planUpdateSchema.safeParse({ start_time: "not-a-date" }).success).toBe(false);
    expect(planUpdateSchema.safeParse({ total_expected_minutes: 1.5 }).success).toBe(false);
    expect(planUpdateSchema.safeParse({ surprise: true }).success).toBe(false);
  });
});

describe("aid-station create schema", () => {
  it("accepts the two required cumulative values plus optional fields", () => {
    expect(
      aidStationCreateSchema.safeParse({ cumulative_distance_km: 50, cumulative_elevation_gain_m: 2000 }).success,
    ).toBe(true);
    expect(
      aidStationCreateSchema.safeParse({
        cumulative_distance_km: 50,
        cumulative_elevation_gain_m: 2000,
        water_only: true,
        notes: "crew here",
      }).success,
    ).toBe(true);
  });

  it("rejects missing required fields, negatives, and unknown keys", () => {
    expect(aidStationCreateSchema.safeParse({ cumulative_distance_km: 50 }).success).toBe(false);
    expect(
      aidStationCreateSchema.safeParse({ cumulative_distance_km: -1, cumulative_elevation_gain_m: 0 }).success,
    ).toBe(false);
    expect(
      aidStationCreateSchema.safeParse({ cumulative_distance_km: 1, cumulative_elevation_gain_m: 1, plan_id: "x" })
        .success,
    ).toBe(false);
  });
});

describe("draft creation + RLS on the new write paths", () => {
  let userIdA = "";
  let userIdB = "";
  let clientA: Client;
  let clientB: Client;
  let planAId = "";

  beforeAll(async () => {
    assertLocal(SUPABASE_URL);

    const { data: a, error: ea } = await admin.auth.admin.createUser({
      email: emailA,
      password: PASSWORD,
      email_confirm: true,
    });
    if (ea ?? !a.user) throw ea ?? new Error("failed to create user A");
    userIdA = a.user.id;

    const { data: b, error: eb } = await admin.auth.admin.createUser({
      email: emailB,
      password: PASSWORD,
      email_confirm: true,
    });
    if (eb ?? !b.user) throw eb ?? new Error("failed to create user B");
    userIdB = b.user.id;

    clientA = anonClient();
    clientB = anonClient();
    const { error: sa } = await clientA.auth.signInWithPassword({ email: emailA, password: PASSWORD });
    if (sa) throw sa;
    const { error: sb } = await clientB.auth.signInWithPassword({ email: emailB, password: PASSWORD });
    if (sb) throw sb;
  });

  afterAll(async () => {
    if (userIdA) await admin.auth.admin.deleteUser(userIdA);
    if (userIdB) await admin.auth.admin.deleteUser(userIdB);
  });

  it("createDraftPlan inserts a row satisfying every NOT-NULL column", async () => {
    const plan = await createDraftPlan(clientA, userIdA);
    planAId = plan.id;
    expect(plan.name).toBe("Untitled plan");
    expect(plan.total_distance_km).toBe(0);
    expect(plan.total_elevation_gain_m).toBe(0);
    expect(plan.total_elevation_loss_m).toBe(0);
    expect(plan.total_expected_minutes).toBe(0);
    expect(plan.hourly_fluid_ml).toBe(0);
    expect(plan.hourly_carb_g).toBe(0);
    expect(plan.hourly_sodium_mg).toBe(0);
    expect(typeof plan.start_time).toBe("string");
    expect(plan.user_id).toBe(userIdA);
  });

  it("runner A can create and delete its own aid station", async () => {
    const station = await createAidStation(clientA, {
      plan_id: planAId,
      cumulative_distance_km: 50,
      cumulative_elevation_gain_m: 2000,
    });
    expect(station.plan_id).toBe(planAId);
    await deleteAidStation(clientA, station.id);
    const remaining = await listAidStations(clientA, planAId);
    expect(remaining.find((s) => s.id === station.id)).toBeUndefined();
  });

  it("runner B cannot create an aid station on runner A's plan (WITH CHECK → 42501)", async () => {
    await expect(
      createAidStation(clientB, { plan_id: planAId, cumulative_distance_km: 10, cumulative_elevation_gain_m: 100 }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("runner B's delete of runner A's aid station is a no-op", async () => {
    const station = await createAidStation(clientA, {
      plan_id: planAId,
      cumulative_distance_km: 80,
      cumulative_elevation_gain_m: 3000,
    });
    await deleteAidStation(clientB, station.id); // RLS hides it → no error, no effect
    const stillThere = await listAidStations(clientA, planAId);
    expect(stillThere.find((s) => s.id === station.id)?.id).toBe(station.id);
  });
});

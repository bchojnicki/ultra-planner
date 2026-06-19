// Backend integration + schema tests for aid-station editing (edit-aid-stations).
//
// The PATCH endpoint is a thin wrapper over updateAidStation + aidStationUpdateSchema,
// so we test those layers directly (the full HTTP path is covered by the Phase 2
// Playwright e2e). Proves: the update schema accepts/rejects correctly, a partial
// update persists only the given fields, and the write path is owner-scoped by RLS.
//
// PREREQUISITES — run against LOCAL Supabase only:
//   1. Docker running, then `npx supabase start`
//   2. Migration applied: `npx supabase db reset`
//   3. `npx vitest run tests/integration/aid-station-edit.test.ts`

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/types";
import { createAidStation, listAidStations, updateAidStation } from "../../src/lib/services/aid-stations";
import { createDraftPlan } from "../../src/lib/services/plans";
import { aidStationUpdateSchema } from "../../src/lib/schemas";

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
const emailA = `asedit-a-${stamp}@example.com`;
const emailB = `asedit-b-${stamp}@example.com`;

describe("aid-station update schema", () => {
  it("accepts a partial patch (only the changed fields)", () => {
    expect(aidStationUpdateSchema.safeParse({ notes: "crew here", water_only: true }).success).toBe(true);
    expect(aidStationUpdateSchema.safeParse({ cumulative_distance_km: 42 }).success).toBe(true);
    expect(aidStationUpdateSchema.safeParse({}).success).toBe(true); // empty = no-op
  });

  it("rejects negatives, unknown keys, and wrong types", () => {
    expect(aidStationUpdateSchema.safeParse({ cumulative_distance_km: -1 }).success).toBe(false);
    expect(aidStationUpdateSchema.safeParse({ surprise: true }).success).toBe(false);
    expect(aidStationUpdateSchema.safeParse({ water_only: "yes" }).success).toBe(false);
  });
});

describe("updateAidStation + RLS", () => {
  let userIdA = "";
  let userIdB = "";
  let clientA: Client;
  let clientB: Client;
  let planAId = "";
  let stationId = "";

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

    const plan = await createDraftPlan(clientA, userIdA);
    planAId = plan.id;
    const station = await createAidStation(clientA, {
      plan_id: planAId,
      cumulative_distance_km: 40,
      cumulative_elevation_gain_m: 1000,
      notes: "original",
    });
    stationId = station.id;
  });

  afterAll(async () => {
    if (userIdA) await admin.auth.admin.deleteUser(userIdA);
    if (userIdB) await admin.auth.admin.deleteUser(userIdB);
  });

  it("owner can patch its own station; only given fields change", async () => {
    const updated = await updateAidStation(clientA, stationId, {
      notes: "crew + drop bag",
      drop_bag_available: true,
      cumulative_elevation_loss_m: 800,
    });
    expect(updated.notes).toBe("crew + drop bag");
    expect(updated.drop_bag_available).toBe(true);
    expect(updated.cumulative_elevation_loss_m).toBe(800);
    // Untouched fields keep their original values.
    expect(updated.cumulative_distance_km).toBe(40);
    expect(updated.cumulative_elevation_gain_m).toBe(1000);
    expect(updated.water_only).toBe(false);
  });

  it("runner B cannot patch runner A's station (RLS → PGRST116 = 404)", async () => {
    await expect(updateAidStation(clientB, stationId, { notes: "hijack" })).rejects.toMatchObject({
      code: "PGRST116",
    });
    // A's station is unchanged by the rejected attempt.
    const [station] = await listAidStations(clientA, planAId);
    expect(station.notes).toBe("crew + drop bag");
  });
});

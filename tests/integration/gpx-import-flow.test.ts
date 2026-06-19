// Backend integration + schema tests for the GPX import slice (gpx-import, Phase 3).
//
// The import endpoint is a thin wrapper over updatePlan + the replace-all
// aid-station helpers + gpxImportSchema, so we test those layers directly (the
// full HTTP path is covered by the Phase 5 Playwright e2e). Proves: the schema
// accepts/rejects correctly, replace-all swaps the station set and writes the
// plan's gpx_* + total_* values, and the write paths are owner-scoped by RLS.
//
// PREREQUISITES — run against LOCAL Supabase only:
//   1. Docker running, then `npx supabase start`
//   2. Migration applied: `npx supabase db reset`
//   3. `npx vitest run tests/integration/gpx-import-flow.test.ts`

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/types";
import {
  bulkInsertAidStations,
  createAidStation,
  deleteAidStationsForPlan,
  listAidStations,
} from "../../src/lib/services/aid-stations";
import { createDraftPlan, getPlan, updatePlan } from "../../src/lib/services/plans";
import { gpxImportSchema } from "../../src/lib/schemas";

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
const emailA = `gpx-a-${stamp}@example.com`;
const emailB = `gpx-b-${stamp}@example.com`;

const validImport = {
  gpx_distance_km: 240.52,
  gpx_elevation_gain_m: 8489,
  gpx_elevation_loss_m: 8490,
  total_distance_km: 240,
  total_elevation_gain_m: 7670,
  total_elevation_loss_m: 7670,
  stations: [
    { cumulative_distance_km: 40, cumulative_elevation_gain_m: 1500, cumulative_elevation_loss_m: 1400, notes: "AS1" },
    { cumulative_distance_km: 120, cumulative_elevation_gain_m: 4200, cumulative_elevation_loss_m: 4100, notes: "AS2" },
  ],
};

describe("gpx-import schema", () => {
  it("accepts a valid import payload (totals + stations)", () => {
    expect(gpxImportSchema.safeParse(validImport).success).toBe(true);
  });

  it("accepts an import with no stations (GPX without waypoints)", () => {
    expect(gpxImportSchema.safeParse({ ...validImport, stations: [] }).success).toBe(true);
  });

  it("rejects negatives, missing totals, unknown keys, and bad station shape", () => {
    expect(gpxImportSchema.safeParse({ ...validImport, gpx_distance_km: -1 }).success).toBe(false);
    const { total_elevation_loss_m, ...missing } = validImport;
    void total_elevation_loss_m;
    expect(gpxImportSchema.safeParse(missing).success).toBe(false);
    expect(gpxImportSchema.safeParse({ ...validImport, surprise: true }).success).toBe(false);
    expect(
      gpxImportSchema.safeParse({
        ...validImport,
        stations: [{ cumulative_distance_km: 1, cumulative_elevation_gain_m: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("replace-all import + RLS", () => {
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

    const plan = await createDraftPlan(clientA, userIdA);
    planAId = plan.id;
  });

  afterAll(async () => {
    if (userIdA) await admin.auth.admin.deleteUser(userIdA);
    if (userIdB) await admin.auth.admin.deleteUser(userIdB);
  });

  it("writes gpx_* + corrected total_* onto the plan", async () => {
    const { stations, ...totals } = validImport;
    void stations;
    const plan = await updatePlan(clientA, planAId, totals);
    expect(plan.gpx_distance_km).toBe(240.52);
    expect(plan.gpx_elevation_gain_m).toBe(8489);
    expect(plan.gpx_elevation_loss_m).toBe(8490);
    expect(plan.total_distance_km).toBe(240);
    expect(plan.total_elevation_gain_m).toBe(7670);
    expect(plan.total_elevation_loss_m).toBe(7670);
  });

  it("replaces the station set (no duplicates) and stores loss", async () => {
    // Seed a pre-existing station that the import must delete.
    await createAidStation(clientA, {
      plan_id: planAId,
      cumulative_distance_km: 200,
      cumulative_elevation_gain_m: 6000,
    });

    await deleteAidStationsForPlan(clientA, planAId);
    const inserted = await bulkInsertAidStations(clientA, planAId, validImport.stations);
    expect(inserted).toHaveLength(2);

    const remaining = await listAidStations(clientA, planAId);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((s) => s.notes)).toEqual(["AS1", "AS2"]);
    expect(remaining.map((s) => s.cumulative_elevation_loss_m)).toEqual([1400, 4100]);
  });

  it("bulk-inserting zero stations is a no-op (GPX without waypoints)", async () => {
    const inserted = await bulkInsertAidStations(clientA, planAId, []);
    expect(inserted).toEqual([]);
  });

  it("runner B cannot import onto runner A's plan (updatePlan → PGRST116 = 404)", async () => {
    const { stations, ...totals } = validImport;
    void stations;
    await expect(updatePlan(clientB, planAId, totals)).rejects.toMatchObject({ code: "PGRST116" });
    // And A's plan values are untouched by the rejected attempt.
    const plan = await getPlan(clientA, planAId);
    expect(plan?.total_elevation_gain_m).toBe(7670);
  });

  it("runner B cannot bulk-insert stations onto runner A's plan (WITH CHECK → 42501)", async () => {
    await expect(bulkInsertAidStations(clientB, planAId, validImport.stations)).rejects.toMatchObject({
      code: "42501",
    });
  });
});

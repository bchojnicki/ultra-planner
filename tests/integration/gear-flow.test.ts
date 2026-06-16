// Backend integration + schema tests for the gear slice (S-03, Phase 1).
//
// Phase 1 has no service layer yet (that lands in Phase 2), so RLS is exercised
// directly against the new tables via authenticated clients. Proves: the gear
// schemas accept/reject correctly, and gear_items / gear_segment_selections are
// owner-scoped through the parent plan (plan-subquery RLS pattern).
//
// PREREQUISITES — run against LOCAL Supabase only (same as plans-flow):
//   1. Docker running, then `npx supabase start`
//   2. Migration applied: `npx supabase db reset`
//   3. `npx vitest run tests/integration/gear-flow.test.ts`
//
// ENV defaults to the Supabase CLI's well-known local keys; a localhost guard
// refuses to run against a non-local SUPABASE_URL (see assertLocal).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/types";
import { createDraftPlan } from "../../src/lib/services/plans";
import { createGearItem, deleteGearItem, listGearItems, updateGearItem } from "../../src/lib/services/gear-items";
import {
  deleteSelectionsForSegments,
  listGearSelections,
  upsertGearSelection,
} from "../../src/lib/services/gear-selections";
import { gearItemCreateSchema, gearItemUpdateSchema, gearSelectionUpsertSchema } from "../../src/lib/schemas";

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
const emailA = `s03-a-${stamp}@example.com`;
const emailB = `s03-b-${stamp}@example.com`;

describe("gear-item create schema", () => {
  it("accepts a valid gel with carbs, sodium, and ratio", () => {
    const r = gearItemCreateSchema.safeParse({
      kind: "gel",
      name: "SIS gel",
      carb_g: 22,
      sodium_mg: 10,
      carb_ratio: 2,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a minimal item (kind + name only)", () => {
    expect(gearItemCreateSchema.safeParse({ kind: "water_carrier", name: "Bladder" }).success).toBe(true);
  });

  it("accepts explicit null nutrition fields", () => {
    expect(
      gearItemCreateSchema.safeParse({ kind: "salt_cap", name: "Salt", carb_g: null, fluid_ml: null, sodium_mg: 200 })
        .success,
    ).toBe(true);
  });

  it("rejects unknown kind, empty name, negatives, and unknown keys", () => {
    expect(gearItemCreateSchema.safeParse({ kind: "rocket", name: "x" }).success).toBe(false);
    expect(gearItemCreateSchema.safeParse({ kind: "gel", name: "" }).success).toBe(false);
    expect(gearItemCreateSchema.safeParse({ kind: "gel", name: "g", carb_g: -1 }).success).toBe(false);
    expect(gearItemCreateSchema.safeParse({ kind: "gel", name: "g", plan_id: "x" }).success).toBe(false);
  });
});

describe("gear-item update schema", () => {
  it("accepts an empty patch and a partial patch", () => {
    expect(gearItemUpdateSchema.safeParse({}).success).toBe(true);
    expect(gearItemUpdateSchema.safeParse({ carb_g: 30 }).success).toBe(true);
  });

  it("rejects unknown keys and empty name", () => {
    expect(gearItemUpdateSchema.safeParse({ surprise: 1 }).success).toBe(false);
    expect(gearItemUpdateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("gear-selection upsert schema", () => {
  it("accepts a cap, a pin, or both", () => {
    const id = "00000000-0000-0000-0000-000000000000";
    expect(gearSelectionUpsertSchema.safeParse({ gear_item_id: id, segment_index: 0, limit_units: 1 }).success).toBe(
      true,
    );
    expect(gearSelectionUpsertSchema.safeParse({ gear_item_id: id, segment_index: 2, override_units: 3 }).success).toBe(
      true,
    );
    expect(
      gearSelectionUpsertSchema.safeParse({ gear_item_id: id, segment_index: 0, limit_units: null, override_units: 4 })
        .success,
    ).toBe(true);
  });

  it("rejects non-uuid item id, negative/fractional units, negative index, unknown keys", () => {
    expect(gearSelectionUpsertSchema.safeParse({ gear_item_id: "nope", segment_index: 0 }).success).toBe(false);
    const id = "00000000-0000-0000-0000-000000000000";
    expect(gearSelectionUpsertSchema.safeParse({ gear_item_id: id, segment_index: -1 }).success).toBe(false);
    expect(gearSelectionUpsertSchema.safeParse({ gear_item_id: id, segment_index: 0, limit_units: 1.5 }).success).toBe(
      false,
    );
    expect(
      gearSelectionUpsertSchema.safeParse({ gear_item_id: id, segment_index: 0, override_units: -1 }).success,
    ).toBe(false);
    expect(gearSelectionUpsertSchema.safeParse({ gear_item_id: id, segment_index: 0, surprise: true }).success).toBe(
      false,
    );
  });
});

describe("gear RLS on the new tables (ownership flows through plan_id)", () => {
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

  it("runner A can insert, read, and delete a gear item on their own plan", async () => {
    const ins = await clientA
      .from("gear_items")
      .insert({ plan_id: planAId, kind: "gel", name: "SIS gel", carb_g: 22, sodium_mg: 10, carb_ratio: 2 })
      .select()
      .single();
    if (ins.error) throw ins.error;
    const itemId = ins.data.id;

    const read = await clientA.from("gear_items").select("*").eq("plan_id", planAId);
    if (read.error) throw read.error;
    expect(read.data.find((g) => g.id === itemId)).toBeTruthy();

    const del = await clientA.from("gear_items").delete().eq("id", itemId);
    expect(del.error).toBeNull();
  });

  it("runner B cannot insert a gear item on runner A's plan (WITH CHECK → 42501)", async () => {
    const res = await clientB
      .from("gear_items")
      .insert({ plan_id: planAId, kind: "gel", name: "Sneaky", carb_g: 22 })
      .select()
      .single();
    expect(res.error?.code).toBe("42501");
  });

  it("runner B cannot read runner A's gear items (RLS hides rows)", async () => {
    const a = await clientA
      .from("gear_items")
      .insert({ plan_id: planAId, kind: "drink", name: "Tailwind", carb_g: 50, fluid_ml: 500, carb_ratio: 1 })
      .select()
      .single();
    if (a.error) throw a.error;

    const b = await clientB.from("gear_items").select("*").eq("plan_id", planAId);
    expect(b.error).toBeNull();
    expect(b.data).toHaveLength(0);

    await clientA.from("gear_items").delete().eq("id", a.data.id);
  });

  it("runner A can upsert and delete a per-segment selection; runner B is blocked", async () => {
    const item = await clientA
      .from("gear_items")
      .insert({ plan_id: planAId, kind: "gel", name: "Gel", carb_g: 22, carb_ratio: 1 })
      .select()
      .single();
    if (item.error) throw item.error;
    const gearItemId = item.data.id;

    const sel = await clientA
      .from("gear_segment_selections")
      .insert({ plan_id: planAId, gear_item_id: gearItemId, segment_index: 0, limit_units: 1 })
      .select()
      .single();
    if (sel.error) throw sel.error;
    expect(sel.data.limit_units).toBe(1);

    const bBlocked = await clientB
      .from("gear_segment_selections")
      .insert({ plan_id: planAId, gear_item_id: gearItemId, segment_index: 1, override_units: 5 })
      .select()
      .single();
    expect(bBlocked.error?.code).toBe("42501");

    // Cascade: deleting the gear item removes its selections.
    await clientA.from("gear_items").delete().eq("id", gearItemId);
    const remaining = await clientA.from("gear_segment_selections").select("*").eq("gear_item_id", gearItemId);
    expect(remaining.data).toHaveLength(0);
  });
});

describe("gear services (Phase 2): catalog + selection CRUD and ownership", () => {
  let userIdA = "";
  let userIdB = "";
  let clientA: Client;
  let clientB: Client;
  let planAId = "";

  beforeAll(async () => {
    assertLocal(SUPABASE_URL);

    const { data: a, error: ea } = await admin.auth.admin.createUser({
      email: `s03-svc-a-${stamp}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (ea ?? !a.user) throw ea ?? new Error("failed to create user A");
    userIdA = a.user.id;

    const { data: b, error: eb } = await admin.auth.admin.createUser({
      email: `s03-svc-b-${stamp}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (eb ?? !b.user) throw eb ?? new Error("failed to create user B");
    userIdB = b.user.id;

    clientA = anonClient();
    clientB = anonClient();
    const { error: sa } = await clientA.auth.signInWithPassword({
      email: `s03-svc-a-${stamp}@example.com`,
      password: PASSWORD,
    });
    if (sa) throw sa;
    const { error: sb } = await clientB.auth.signInWithPassword({
      email: `s03-svc-b-${stamp}@example.com`,
      password: PASSWORD,
    });
    if (sb) throw sb;

    const plan = await createDraftPlan(clientA, userIdA);
    planAId = plan.id;
  });

  afterAll(async () => {
    if (userIdA) await admin.auth.admin.deleteUser(userIdA);
    if (userIdB) await admin.auth.admin.deleteUser(userIdB);
  });

  it("createGearItem → listGearItems → updateGearItem → deleteGearItem (happy path)", async () => {
    const created = await createGearItem(clientA, {
      plan_id: planAId,
      kind: "gel",
      name: "Gel",
      carb_g: 22,
      carb_ratio: 2,
    });
    expect(created.kind).toBe("gel");
    expect(created.carb_g).toBe(22);

    const listed = await listGearItems(clientA, planAId);
    expect(listed.find((g) => g.id === created.id)).toBeTruthy();

    const updated = await updateGearItem(clientA, created.id, { carb_g: 25, name: "Gel v2" });
    expect(updated.carb_g).toBe(25);
    expect(updated.name).toBe("Gel v2");

    await deleteGearItem(clientA, created.id);
    const after = await listGearItems(clientA, planAId);
    expect(after.find((g) => g.id === created.id)).toBeUndefined();
  });

  it("createGearItem on a non-owned plan is rejected (42501)", async () => {
    await expect(
      createGearItem(clientB, { plan_id: planAId, kind: "gel", name: "Sneaky", carb_g: 22 }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("upsertGearSelection sets a cap, updates it, then clears the row when both are null", async () => {
    const item = await createGearItem(clientA, {
      plan_id: planAId,
      kind: "gel",
      name: "Gel",
      carb_g: 22,
      carb_ratio: 1,
    });

    const first = await upsertGearSelection(clientA, {
      plan_id: planAId,
      gear_item_id: item.id,
      segment_index: 0,
      limit_units: 1,
    });
    expect(first?.limit_units).toBe(1);

    // Upsert on the same (item, segment) updates rather than duplicating.
    const second = await upsertGearSelection(clientA, {
      plan_id: planAId,
      gear_item_id: item.id,
      segment_index: 0,
      override_units: 3,
    });
    expect(second?.override_units).toBe(3);
    const onlyOne = await listGearSelections(clientA, planAId);
    expect(onlyOne.filter((s) => s.gear_item_id === item.id && s.segment_index === 0)).toHaveLength(1);

    // Empty pair clears the row (sparse contract).
    const cleared = await upsertGearSelection(clientA, { plan_id: planAId, gear_item_id: item.id, segment_index: 0 });
    expect(cleared).toBeNull();
    const none = await listGearSelections(clientA, planAId);
    expect(none.filter((s) => s.gear_item_id === item.id && s.segment_index === 0)).toHaveLength(0);

    await deleteGearItem(clientA, item.id);
  });

  it("deleteSelectionsForSegments removes stale rows and no-ops on an empty list", async () => {
    const item = await createGearItem(clientA, {
      plan_id: planAId,
      kind: "gel",
      name: "Gel",
      carb_g: 22,
      carb_ratio: 1,
    });
    await upsertGearSelection(clientA, { plan_id: planAId, gear_item_id: item.id, segment_index: 0, limit_units: 1 });
    await upsertGearSelection(clientA, {
      plan_id: planAId,
      gear_item_id: item.id,
      segment_index: 2,
      override_units: 2,
    });

    await deleteSelectionsForSegments(clientA, planAId, []); // no-op
    expect(await listGearSelections(clientA, planAId)).toHaveLength(2);

    await deleteSelectionsForSegments(clientA, planAId, [2]);
    const remaining = await listGearSelections(clientA, planAId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].segment_index).toBe(0);

    await deleteGearItem(clientA, item.id);
  });
});

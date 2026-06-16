-- Migration: create gear_items
-- S-03 (gear-profile-units), Phase 1: the per-plan gear catalog.
-- Each plan owns a small catalog of fueling items (gels, drinks, solid food, water
-- carriers, salt caps). The plan table's unit-level output is derived from this catalog
-- plus per-segment selections (next migration); the catalog itself stores per-unit
-- nutrition content and a carb_ratio weight used only for carb auto-suggestion.
--
-- Conventions (CLAUDE.md):
--   - one RLS policy per operation (select/insert/update/delete) per role
--   - never FOR ALL, never USING (true) on user data
--   - gear_items has no user_id; ownership flows through plan_id -> plans.user_id
--     (the same plan-subquery pattern as aid_stations)
--
-- Units: carbohydrate in grams, sodium in milligrams, fluid in ml (per unit/serving),
-- capacity in ml (water carriers). numeric (not float) keeps the nutrition math exact
-- (PRD accuracy guardrail). Per-kind fields are nullable: a gel carries carb_g/sodium_mg,
-- a water carrier only capacity_ml, etc.

-- ---------------------------------------------------------------------------
-- gear_items: a plan's fueling catalog (FR-004)
-- ---------------------------------------------------------------------------
create table gear_items (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references plans (id) on delete cascade,
  kind        text not null check (kind in ('gel', 'drink', 'solid_food', 'water_carrier', 'salt_cap')),
  name        text not null,
  carb_g      numeric,
  sodium_mg   numeric,
  fluid_ml    numeric,
  capacity_ml numeric,
  carb_ratio  numeric not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index gear_items_plan_id_idx on gear_items (plan_id);

create trigger gear_items_set_updated_at
  before update on gear_items
  for each row
  execute function extensions.moddatetime (updated_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security: ownership flows through the parent plan. Each policy gates
-- on plan_id belonging to a plan the current user owns. INSERT/UPDATE enforce this
-- via WITH CHECK so a runner cannot attach a gear item to someone else's plan.
-- ---------------------------------------------------------------------------
alter table gear_items enable row level security;

create policy "gear_items_select_own"
  on gear_items for select
  to authenticated
  using (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

create policy "gear_items_insert_own"
  on gear_items for insert
  to authenticated
  with check (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

create policy "gear_items_update_own"
  on gear_items for update
  to authenticated
  using (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  )
  with check (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

create policy "gear_items_delete_own"
  on gear_items for delete
  to authenticated
  using (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

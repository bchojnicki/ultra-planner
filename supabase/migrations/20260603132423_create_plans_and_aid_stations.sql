-- Migration: create plans and aid_stations
-- F-01 (plan-data-and-ownership): the project's first migration.
-- Establishes the data layer for race plans and their aid stations, owner-scoped
-- via Row-Level Security so a runner can only read/write their own data.
--
-- Conventions (CLAUDE.md):
--   - one RLS policy per operation (select/insert/update/delete) per role
--   - never FOR ALL, never USING (true) on user data
--   - aid_stations has no user_id; ownership flows through plan_id -> plans.user_id
--
-- Units: distance in kilometers, elevation in meters, finish time as whole minutes,
-- fluid in ml, carbohydrate in grams, sodium in milligrams. numeric (not float) for
-- measurements and integer minutes for the finish duration keep the nutrition math
-- exact (PRD accuracy guardrail): hh:mm maps losslessly to total minutes (25:30 -> 1530).

-- moddatetime powers the automatic updated_at maintenance below.
create extension if not exists moddatetime schema extensions;

-- ---------------------------------------------------------------------------
-- plans: a runner's race parameters (FR-003)
-- ---------------------------------------------------------------------------
create table plans (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  name                   text not null,
  total_distance_km      numeric not null,
  total_elevation_gain_m numeric not null,
  total_elevation_loss_m numeric not null,
  start_time             timestamptz not null,
  total_expected_minutes integer not null,
  hourly_fluid_ml        numeric not null,
  hourly_carb_g          numeric not null,
  hourly_sodium_mg       numeric not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index plans_user_id_idx on plans (user_id);

create trigger plans_set_updated_at
  before update on plans
  for each row
  execute function extensions.moddatetime (updated_at);

-- ---------------------------------------------------------------------------
-- aid_stations: heterogeneous checkpoints belonging to a plan (FR-005)
-- Runner enters cumulative distance/elevation; per-segment values are derived
-- downstream (S-01/S-02), not stored here.
-- ---------------------------------------------------------------------------
create table aid_stations (
  id                        uuid primary key default gen_random_uuid(),
  plan_id                   uuid not null references plans (id) on delete cascade,
  cumulative_distance_km    numeric not null,
  cumulative_elevation_gain_m numeric not null,
  time_spent_min            numeric not null default 0,
  water_only                boolean not null default false,
  food_available            boolean not null default false,
  warm_meal                 boolean not null default false,
  drop_bag_available        boolean not null default false,
  rest_area                 boolean not null default false,
  support_crew_allowed      boolean not null default false,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index aid_stations_plan_id_idx on aid_stations (plan_id);

create trigger aid_stations_set_updated_at
  before update on aid_stations
  for each row
  execute function extensions.moddatetime (updated_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table plans enable row level security;
alter table aid_stations enable row level security;

-- plans: owner-scoped via user_id = auth.uid(). One policy per operation,
-- authenticated role only (unauthenticated access denied entirely).
create policy "plans_select_own"
  on plans for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "plans_insert_own"
  on plans for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "plans_update_own"
  on plans for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "plans_delete_own"
  on plans for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- aid_stations: ownership flows through the parent plan. Each policy gates on
-- the plan_id belonging to a plan the current user owns. INSERT/UPDATE enforce
-- this via WITH CHECK so a runner cannot attach a station to someone else's plan.
create policy "aid_stations_select_own"
  on aid_stations for select
  to authenticated
  using (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

create policy "aid_stations_insert_own"
  on aid_stations for insert
  to authenticated
  with check (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

create policy "aid_stations_update_own"
  on aid_stations for update
  to authenticated
  using (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  )
  with check (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

create policy "aid_stations_delete_own"
  on aid_stations for delete
  to authenticated
  using (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

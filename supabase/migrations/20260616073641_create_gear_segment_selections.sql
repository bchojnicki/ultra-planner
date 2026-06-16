-- Migration: create gear_segment_selections
-- S-03 (gear-profile-units), Phase 1: sparse per-stage selection layer.
-- A row exists only when the runner deviates from the live auto-suggestion for a
-- given (gear item, segment): either capping its units for that stage (limit_units)
-- or pinning an exact count (override_units). Absence of a row means "use the live
-- suggestion". Auto-suggestions themselves are never stored.
--
-- Conventions (CLAUDE.md):
--   - one RLS policy per operation (select/insert/update/delete) per role
--   - never FOR ALL, never USING (true) on user data
--   - no user_id; ownership flows through plan_id -> plans.user_id (plan-subquery pattern)
--
-- segment_index is a 0-based ordinal into the computed plan-table rows (Start->AS1 = 0,
-- AS1->AS2 = 1, ...). It is positional: when aid stations change, indices that no longer
-- map are reconciled (deleted) by the application so a quantity is never mis-attributed.
-- limit_units / override_units are whole-unit integers (fractional units are out of scope).

-- ---------------------------------------------------------------------------
-- gear_segment_selections: per-stage caps/overrides over the gear catalog (FR-004)
-- ---------------------------------------------------------------------------
create table gear_segment_selections (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references plans (id) on delete cascade,
  gear_item_id   uuid not null references gear_items (id) on delete cascade,
  segment_index  integer not null check (segment_index >= 0),
  limit_units    integer check (limit_units >= 0),
  override_units integer check (override_units >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (gear_item_id, segment_index)
);

create index gear_segment_selections_plan_id_idx on gear_segment_selections (plan_id);

create trigger gear_segment_selections_set_updated_at
  before update on gear_segment_selections
  for each row
  execute function extensions.moddatetime (updated_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security: ownership flows through the parent plan (same pattern as
-- gear_items and aid_stations). INSERT/UPDATE enforce ownership via WITH CHECK.
-- ---------------------------------------------------------------------------
alter table gear_segment_selections enable row level security;

create policy "gear_segment_selections_select_own"
  on gear_segment_selections for select
  to authenticated
  using (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

create policy "gear_segment_selections_insert_own"
  on gear_segment_selections for insert
  to authenticated
  with check (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

create policy "gear_segment_selections_update_own"
  on gear_segment_selections for update
  to authenticated
  using (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  )
  with check (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

create policy "gear_segment_selections_delete_own"
  on gear_segment_selections for delete
  to authenticated
  using (
    plan_id in (select id from plans where user_id = (select auth.uid()))
  );

-- Migration: enforce gear_segment_selections.plan_id matches its gear item's plan.
-- Review follow-up (S-03, gear-profile-units): the original table denormalized plan_id
-- but only RLS checked it against the caller's plans, so a single user could (via the raw
-- API, never the UI) attach a selection whose plan_id and gear_item_id point at two
-- different owned plans — which would confuse deleteSelectionsForSegments (it filters by
-- plan_id). A composite FK makes that state unrepresentable.
--
-- A composite FK needs a unique key on the referenced columns; gear_items.id is already
-- the PK, so (id, plan_id) is trivially unique and cheap to add. ON DELETE CASCADE keeps
-- the existing "deleting a gear item removes its selections" behavior.

alter table gear_items
  add constraint gear_items_id_plan_id_key unique (id, plan_id);

alter table gear_segment_selections
  add constraint gear_segment_selections_item_plan_fk
  foreign key (gear_item_id, plan_id) references gear_items (id, plan_id) on delete cascade;

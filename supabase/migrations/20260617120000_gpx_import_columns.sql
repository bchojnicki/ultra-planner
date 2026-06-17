-- Migration: GPX import columns
-- gpx-import, Phase 1: persistence for GPX-derived race data.
--
-- Adds the raw GPX-computed measurements to `plans` (the calibration delta's
-- denominator) and a per-station cumulative elevation loss to `aid_stations`
-- (so the plan table can derive and scale segment loss, not just gain).
--
-- Conventions (CLAUDE.md):
--   - additive, nullable/defaulted columns: existing rows stay valid (no backfill)
--   - no RLS changes: ownership already flows through the existing policies
--     (plans.user_id; aid_stations via plan_id -> plans.user_id)
--
-- Units: distance in kilometers, elevation in meters (numeric, matching the
-- existing measurement columns). The three gpx_* columns are nullable —
-- NULL means "no GPX imported for this plan", which the calibration treats as
-- a factor of 1 (no scaling).

-- ---------------------------------------------------------------------------
-- plans: raw GPX-computed totals (the corrected total_* columns remain the
-- user-editable, user-trusted values; these hold the original GPX numbers so
-- the per-metric calibration delta (corrected - gpx)/gpx stays computable).
-- ---------------------------------------------------------------------------
alter table plans
  add column gpx_distance_km        numeric,
  add column gpx_elevation_gain_m   numeric,
  add column gpx_elevation_loss_m   numeric;

-- ---------------------------------------------------------------------------
-- aid_stations: cumulative elevation loss from the start, mirroring the existing
-- cumulative_elevation_gain_m. Non-null with a 0 default so existing stations
-- and manual entries that omit it remain valid.
-- ---------------------------------------------------------------------------
alter table aid_stations
  add column cumulative_elevation_loss_m numeric not null default 0;

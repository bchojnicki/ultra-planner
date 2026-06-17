---
change_id: plan-data-and-ownership
title: Persist plans & aid stations with per-user ownership via RLS
status: archived
created: 2026-06-03
updated: 2026-06-15
archived_at: 2026-06-15T13:19:57Z
---

## Notes

Sourced from `context/foundation/roadmap.md` → **F-01: Plan persistence + per-user ownership** (the foundation slice; status `ready`).

- **Outcome:** plans and aid stations stored server-side, readable/writable only by their owning runner.
- **PRD refs:** FR-008, NFR (no data accessible outside the runner's account), Access Control.
- **Unlocks:** S-01 (auto-saved race setup), S-02 (generation reads persisted plan), S-04/S-05 (dashboard + delete); provides the RLS verification path the privacy NFR requires.
- **Prerequisites:** none — builds on the existing Supabase auth scaffold (Baseline: `present`).
- **Scope guard:** minimal schema (`plans` + `aid_stations`) with one RLS policy per operation per role. Gear table is deferred to S-03 — do not build it here.

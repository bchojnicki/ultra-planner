---
change_id: excel-export
title: Export a plan to an Excel file
created: 2026-06-19
updated: 2026-06-19
status: impl_reviewed
archived_at: null
---

## Notes

Feature (reported 2026-06-19): export a plan (the generated segment-by-segment table) to an Excel file.

⚠️ **Reverses a PRD Non-Goal.** `context/foundation/prd.md` / `roadmap.md` §Parked both list "XLS / Excel export" as an explicit Non-Goal ("the app is the plan; format conversion adds surface area"). The product owner is choosing to build it anyway — the same way GPX import (also a Non-Goal) was un-parked and shipped (`context/archive/2026-06-17-gpx-import/`). Planning should include un-parking it in the PRD/roadmap.

Open decisions for `/10x-shape` or `/10x-plan`: which data (just the plan table, or also race params + gear?), client-side vs server-side generation, and the xlsx library choice for the Cloudflare Workers runtime. Third of 4 post-MVP backlog changes.

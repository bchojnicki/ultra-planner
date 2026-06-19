---
change_id: fix-gear-panel-position
title: Fix gear edit panel rendering under the wrong segment in the plan table
created: 2026-06-19
updated: 2026-06-19
status: archived
archived_at: 2026-06-19T08:27:22Z
---

## Notes

Bug (reported 2026-06-19): in the plan table, opening a segment's gear editor shows the edit/limit-override panel **under the last segment**, not under the segment being edited. With multiple gear panels open at once it's especially confusing — they all stack at the bottom.

**Root cause (confirmed):** `src/components/plans/PlanTable.tsx` renders the expanded gear panels in a **separate trailing `rows.map(...)` block** (~line 338), appended after all data rows in the same `<tbody>`, instead of interleaving each panel `<tr>` immediately after its own data row. Every expanded panel therefore renders at the end of the table.

**Likely fix:** render each segment's gear panel `<tr>` right after that segment's data `<tr>` (e.g. emit both from the single rows map via a fragment), and verify multiple simultaneously-open panels each sit under their own row.

Bug-shape with a confirmed cause → ready for `/10x-plan` (frame not needed). First of 4 post-MVP backlog changes; planned first as a quick, independent win.

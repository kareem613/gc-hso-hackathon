---
name: hso-status-update
description: >-
  Checks investigation progress in status.md against the local codebase and
  live GKE/AlloyDB environment using investigation_guide.md and status.md as
  the source of truth, offers to mark newly completed steps in status.md, and
  tells the user the exact next step to work on. Use whenever the user triggers
  /hso-status-update or hso-status-update, asks where they are in the
  investigation, asks what to do next, or asks to check or update status.md.
---

# Investigation Status Tracker Skill (`hso-status-update`)

Audit investigation progress and guide the user to their next step using `investigation_guide.md` and `status.md` as the single source of truth. Do not assume a hardcoded list of datasets or steps—always derive them from those two files.

## Workflow

1. **Read the Source-of-Truth Files:**
   - Read `investigation_guide.md` and `status.md` at the repository root (if `status.md` does not exist yet, read `status.md.example`) to understand the dataset order, workflow steps, and which items are already marked complete (`- [x]`).

2. **Verify Unchecked Items Against Local & Live Environments:**
   - Starting from the first unchecked (`- [ ]`) item in `status.md`, inspect the environment sequentially until you reach the first item that has **not** been completed:
     - **Local implementation steps** (e.g., schema design, ingest job updates, UI visualization): inspect the local files referenced in `investigation_guide.md` and `status.md` to verify whether the changes for that dataset have been implemented.
     - **Live execution / database steps** (e.g., running the ingest job, reviewing/analyzing in AlloyDB, GKE deployment): query the live AlloyDB/GKE environment (using the `alloydb` MCP server or `kubectl` as documented in `AGENTS.md`) and conversation/status context to verify whether the dataset's tables exist, contain ingested rows, and have been deployed/reviewed/analyzed.

3. **Offer to Update `status.md` via Multi-Select & Report the Next Step:**
   - **Never modify `status.md` without direct approval from the user.**
   - If any unchecked (`- [ ]`) items in `status.md` are verified as completed:
     - Briefly summarize the evidence found and identify the **first incomplete item** as the next step the user should do.
     - Prompt the user with a **multi-select** question (`ask_question` with `is_multi_select: true` when available, or a numbered multi-select list) where each verified completed item is an option (plus an option to skip updating `status.md`), and mark only the user-selected items `- [x]` in `status.md`.
   - If no unchecked items have been completed yet, tell the user the **first incomplete item** from `status.md` that they should do next.

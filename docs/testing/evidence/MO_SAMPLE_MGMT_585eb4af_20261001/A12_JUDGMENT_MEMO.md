# A12 judgment memo — historical main @ `585eb4af`

**Historical record:** Session prep on product **`585eb4afbd38c361c5af8c32e1b5920a8bbaf9c8`** (2026-09-30 / 2026-10-01). Current product `main` at amendment 1: **`ad4953c7f2c6d559e24f0b28e2037606691df1e6`**. **Normative A12 PASS criteria after amendment 1:** [`docs/planning/M7_EXIT_AUDIT.md`](../../../planning/M7_EXIT_AUDIT.md) §15.A.1 **Stale (A12)**. Matrix **A12** remains **NOT_RUN**; **M7** **IN_PROGRESS**.

**Work ID:** `MO-SAMPLE-MANAGEMENT-CURRENT-MAIN-1`  
**Matrix row:** A12 — Stale draft fail-closed (no-write)  
**Recorded:** 2026-10-01  
**Operator choice (session start):** contract tests + this memo first; **defer** full Native until A12 method is decided.

## Canonical requirements (snapshot before amendment 1)

These bullets were the active gate when this memo was first written. Amendment 1 (`MO-M7-A12-CANONICAL-CRITERION-AMENDMENT-1`, 2026-10-01) superseded the stale requirement with composite layer A + layer B in the exit audit; retain this section as history only.

- [`docs/planning/M7_EXIT_AUDIT.md`](../../../planning/M7_EXIT_AUDIT.md) §15.A.1 (pre-amendment): real draft revision advance, then stale confirm rejected; published file count and lineage count unchanged. Modal that only blocks edits is insufficient; `STALE_DRAFT` IPC optional if UI already blocks confirm.
- [`docs/testing/M7_INTEGRATED_NATIVE_ACCEPTANCE.md`](../../M7_INTEGRATED_NATIVE_ACCEPTANCE.md): pending review while advancing revision; supported real UI path only; **NOT_RUN/BLOCKED** if missing path.
- Session 3 matrix [`M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md`](../../M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md) labels A12 but did **not** define steps to keep export review open while advancing revision.

## Product UI on `585eb4af` (still true on `ad4953c7` for invalidation behavior)

**File:** `src/features/slicing/SliceWorkbench.tsx`

- Export uses two-step review (`exportReview` with `expectedRevision` captured at review open).
- `useEffect` clears `exportReview` when `draft.revision`, marker selection, or marker range changes.
- Separate effect clears review when `editing` is true (draft edit in flight).
- On confirm, if live draft/marker no longer matches review snapshot, review is cleared and export is **not** sent (no stale IPC with old revision from UI).

**Pre-amendment Native gap:** no UI path to keep pending review open while advancing revision, so “reject stale confirm after advance with review left open” was not reproducible without product changes.

**Post-amendment Native layer A:** observe review invalidation after revision advance (see exit audit §15.A.1); do not require sending a stale export from the UI.

**Frontend contract (jsdom, auxiliary only):** `invalidates export confirmation while a draft edit is pending` — **PASS** on `585eb4af`; re-run **PASS** on `ad4953c7` during amendment 1 (`pnpm exec vitest run src/features/slicing/SliceWorkbench.test.tsx -t "invalidates export confirmation while a draft edit is pending"`).

## Rust command boundary (layer B)

**Test:** `slice_export_ipc_rejects_stale_revision_after_draft_advance_without_writes` in `src-tauri/src/slice_export_apply.rs`.

| Baseline SHA | Result |
| --- | --- |
| `585eb4af` (PR #176 session) | **PASS** (local) |
| `ad4953c7` (amendment 1) | **PASS** (`cargo test --locked stale_revision_after_draft_advance`) |

Proves: after catalog `save_slice_draft` advances revision, export apply with prior `expected_revision` returns `STALE_DRAFT`; derivation count and published `.wav` / `.part` counts unchanged; draft revision stays at **N+1**. Does **not** prove marker body or lineage row identity beyond those counts.

Does **not** prove: Native AX, operator gestures, or integrated session **A12 PASS** without layer A.

## Session conclusion for A12 (unchanged)

| Field | Value |
| --- | --- |
| **A12 result (585eb4af prep session)** | **NOT_RUN** |
| **Reason (pre-amendment)** | No Native path matching old “stale confirm while review stays open” wording |
| **After amendment 1** | Criteria updated; still **NOT_RUN** until Native layer A is recorded on a reviewed session |
| **Automated partial evidence** | Rust layer B + jsdom invalidation (auxiliary) |

## Gate for full Native session

Complete integrated Native per session 3 (or a newer current-main acceptance record) using exit audit §15.A.1 **Stale (A12)**. Do not treat Rust or jsdom alone as **PASS**.

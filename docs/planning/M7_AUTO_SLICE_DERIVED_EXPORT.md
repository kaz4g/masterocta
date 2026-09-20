# M7 Auto Slice → Derived export (1 slice)

- Work ID: `MO-M7-AUTO-SLICE-DERIVED-EXPORT-1`
- Status: **IMPLEMENTED** (application vertical slice; no production UI/IPC)
- Updated: 2026-09-20

## Purpose

Connect persisted **Slice Draft** boundaries to the existing **Mac derived TRIM**
pipeline: one user-confirmed slice becomes a derived WAV under Application Support,
catalog `mac_derived` projection, and **`SLICE_EXPORT`** lineage. Original Octatrack
media bytes are not modified.

## Boundary

| Layer | Responsibility |
| --- | --- |
| `SliceDraft` / SQLite | Draft revision CAS, stable `marker_id`, half-open ranges |
| `ApplySliceExportDerivation` | Draft/source/range stale checks; delegates PCM to TRIM engine |
| `prepare_publish_trim_derivation` | Shared bind → trim → independent PCM verify → publish → catalog upsert |
| Lineage | `DerivationKind::SliceExport` + `v1\|kind=slice_export\|start=\|end=` (end exclusive) |

Processing semantics = integer PCM TRIM. Business provenance = slice export (not generic TRIM).

## Stale protection (fail closed, no side effects before publish)

- Binding `source_hash` ≠ intent source → `SourceChanged`
- Live bytes / caller hash binding (same as TRIM) → `SourceChanged`
- No draft row → `DraftNotFound`
- `draft.revision` ≠ `expected_revision` → `StaleDraft`
- Unknown `marker_id` → `SliceMissing`
- Resolved range ≠ intent range → `RangeChanged`
- Range outside source frames → `InvalidRange`
- Output content hash = source → `NoOpDerivation` (no publish / catalog / lineage)

## Storage

Reuses `MasterOCTa/derived-audio/published/v1/{sha256}.wav` and catalog schema **13**.
No separate `slice-exports/` root.

## Retry / idempotency

Same source bytes + same slice range → same output hash → publish reuse and semantically
equal `SLICE_EXPORT` lineage registration is a no-op.

If the same output hash already has **TRIM** (or other) lineage, registration returns
`ConflictingLineage` (1 output = 1 parent).

## Explicit non-goals (this Work ID)

- Multi-slice batch export
- Sample chain, `.ot` writer, Octatrack media Apply
- Production Tauri IPC / Slice Inspector Export button
- Native operator acceptance (NOT_RUN until UI wired)

## Next

- `MO-M7-AUTO-SLICE-DERIVED-EXPORT-UI-1` — opaque IPC + minimal Inspector export
- `MO-M7-DERIVED-QUERY-API-1` — read-only lineage query

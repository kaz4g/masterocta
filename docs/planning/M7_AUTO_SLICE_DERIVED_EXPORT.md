# M7 Auto Slice → Derived export (1 slice)

- Work IDs:
  - `MO-M7-AUTO-SLICE-DERIVED-EXPORT-1` — application vertical slice (**MERGED** #152)
  - `MO-M7-AUTO-SLICE-DERIVED-EXPORT-UI-1` — opaque IPC + Slice Workspace export (**MERGED** #153)
  - `MO-M7-DERIVED-LINEAGE-QUERY-UI-1` — read-only lineage query IPC + Inspector Info (**IN_PROGRESS**)
- Updated: 2026-09-21

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

## Production IPC (`v2_slice_export_apply`)

Opaque inputs only: `rootId`, `fileInstanceId`, `markerId`, `expectedRevision`.
The backend reloads the persisted draft, resolves `marker_range`, verifies live WAV
bytes against the catalog hash (64 MiB cap), and runs `ApplySliceExportDerivation`
via shared `DerivedAudioRuntime` + catalog mutex. Response:
`derivedAssetId`, `sourceUnchanged`, `startFrame`, `endExclusive` (decimal strings;
no raw hash/path). Errors map to `STALE_DRAFT`, `SLICE_MISSING`, `SOURCE_CHANGED`,
`RANGE_CHANGED`, `NO_OP_DERIVATION`, `CONFLICTING_LINEAGE`,
`DERIVED_AUDIO_VERIFICATION_FAILED`, `DERIVED_AUDIO_PUBLISH_FAILED`.

## Slice Workspace UI

Single selected marker: review (name, frames, duration) → lightweight confirm →
「派生素材として書き出す」. Success is shown in-workspace (opaque id). Library
Browser does **not** rescan OT roots; `mac_derived` remains outside OT library list
until lineage query landed (`MO-M7-DERIVED-LINEAGE-QUERY-UI-1`).

## Lineage query (Inspector)

- `v2_asset_derivation_get` — immediate parent for a derived asset.
- `v2_asset_derivation_list_children` — one-level derived outputs for an original asset.
- Inspector Info: primary path is **original → children** after export on the source sample.
- Native evidence: [`../testing/M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md`](../testing/M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md).

## Explicit non-goals

- Multi-slice batch export
- Sample chain, `.ot` writer, Octatrack media Apply
- Derived assets in OT `v2_library_list` refresh

## Next

- Native acceptance PASS for lineage query UI; mac_derived Library browse remains deferred.

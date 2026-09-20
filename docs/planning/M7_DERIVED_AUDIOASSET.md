# M7 derived AudioAsset

- Work IDs: `MO-M7-DERIVED-AUDIOASSET-1` (lineage), `MO-M7-DERIVED-AUDIOASSET-2` (TRIM generation slice), `MO-M7-AUTO-SLICE-DERIVED-EXPORT-1` (1-slice draft export)
- Status: **IMPLEMENTED_NOT_FULLY_ACCEPTED** for M7-06 (implementation on `main` #147–#154; Native **NOT_RUN**). Do not treat this file’s historical slices as the live exit map — see [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md).
- Updated: 2026-09-21

## Purpose

Persist **original → derived** relationships and, for TRIM, produce **Mac-side derived WAV**
under Application Support without mutating Octatrack media or conflating content identity
with filesystem paths.

Slice #1 (#147) added lineage registration only. Slice #2 adds **lossless integer PCM WAV
TRIM** → verify → content-addressed publish → catalog (`mac_derived`) → lineage.
Later slices added production IPC/UI (#152–#154). Native remains **NOT_RUN**.
Media Apply is still out of scope.

## Identity

| Concept | Meaning |
| --- | --- |
| `AudioAsset` | SHA-256 **content identity** (`ContentHash` + byte size) |
| `FileInstance` | Root-relative path observation bound to one content hash |
| Derived lineage | Catalog edge: output asset was produced from source asset |
| Mac derived root | Catalog-internal well-known root (`MAC_DERIVED_AUDIO_ROOT_FINGERPRINT`); not a RootRegistry Octatrack session |

Derived assets are **not** a separate domain type. A derived sample is still an
`AudioAsset` once indexed; lineage is metadata stored in `asset_derivations`.

Frontend/API identity remains opaque `asset:v1:` identifiers. Raw content hashes
and absolute paths are not exposed to the UI.

## TRIM generation (slice #2)

| Step | Behavior |
| --- | --- |
| Input | Verified source bytes + `TrimIntent` (source hash + half-open `FrameRange`) |
| Bind | Re-hash source bytes before processing; mismatch with intent/caller → `SourceMismatch` (no side effects) |
| Process | Integer PCM WAV only (16/24-bit, mono/stereo, 44.1/48 kHz); byte-preserving data slice |
| Verify | Apply re-parses source/output WAV and requires **exact PCM payload match** for the trim range (metadata + frame count + payload length); processor `expected` / claimed hashes are not trusted; failures → `Verification` before publish |
| No-op | Output content hash equals source → `NoOpDerivation` before publish/catalog/lineage |
| Staging | `{data_dir}/MasterOCTa/derived-audio/staging/`; `.part` files removed on write/sync/rename failure |
| Publish | `{data_dir}/MasterOCTa/derived-audio/published/v1/{sha256}.wav`; symlinks/non-regular paths rejected; no overwrite on hash mismatch |
| Catalog | Incremental `upsert_derived_file` with scan session + root pointer in one transaction (reuse repairs stale pointer, never downgrades) |
| Lineage | `DerivationKind::Trim` with `v1\|kind=trim\|start=\|end=` envelope; processor `masterocta-trim` / `pcm-wav-v1` |

Idempotency: same source + TRIM parameters → same output hash → reuse published file;
semantically equal lineage → registration no-op.

**Read compatibility:** catalog rows written under migration 12 with `TRIM` + `v1|kind=empty`
load as legacy unspecified parameters (`parameters_unavailable`); frame ranges are not invented.

**Write strictness:** new registration requires typed TRIM parameters only. Legacy/unavailable
representations are read-only; `register_asset_derivation` rejects them even when re-registering
a loaded legacy row (no new `v1|kind=empty` rows).

## Provenance

Each lineage row records:

- `source` and `output` content hashes (resolved to catalog rows at registration)
- `kind` (closed enum: TRIM, NORMALIZE, RESAMPLE, …, STEM, …)
- `processor` name + revision (no paths, session IDs, or secrets)
- `parameters_envelope` (versioned `v1` typed envelope; TRIM requires frame range; STEM supports `role`)
- `source_hash_evidence` (must equal source at registration time)
- `created_at` (RFC3339, supplied by application/catalog boundary)

## Safety invariants

1. Original Octatrack files are never modified by this layer.
2. No metadata is written to removable media.
3. Lineage and Mac derived files live in Application Support only.
4. One immediate parent per output asset.
5. Self-reference and cycles are rejected in domain and SQLite trigger.
6. Rescan orphan cleanup must not delete assets referenced by lineage.
7. Registration requires both assets to exist in the catalog (fail closed).
8. Stale source evidence is rejected; re-attribution to changed source is blocked.
9. `mac_derived` file instances are not valid sources for additive media copy/rename.
10. Octatrack `replace_projection` must not delete derived-root file instances.

## Lifecycle

1. Source exists on an approved Octatrack root (or catalog fixture in tests).
2. **TRIM:** `ApplyTrimDerivation` verifies source hash and PCM, stages WAV, publishes, upserts catalog, registers lineage.
3. **Future:** Other processors follow the same pattern (new kinds / scopes as designed).
4. Queries (`LoadAssetDerivation`, `ListDerivedChildren`) are exposed read-only as
   `v2_asset_derivation_get` / `v2_asset_derivation_list_children` (`MO-M7-DERIVED-LINEAGE-QUERY-UI-1`).
   Opaque `asset:v1:` IDs only; raw content hashes and paths are not returned.
   `parentAvailable=false` when the source has catalog lineage but no current `FileInstance`.
   Legacy v12 TRIM rows load as `parameters.status=unavailable` (no invented frame range).

Deletion of catalog assets referenced by lineage is blocked via `ON DELETE RESTRICT`.

## Failure atomicity (filesystem)

Publish success with catalog/lineage failure leaves a **recoverable orphan** under
`published/v1/`; retry verifies hash and completes catalog/lineage without duplicating files.
Original source bytes and hash are unchanged.

## Future integration boundaries

| Track | Connection |
| --- | --- |
| Auto Slice | **1-slice export** (#152 backend, #153 UI): draft + `marker_id` + revision → shared TRIM engine → `SLICE_EXPORT` lineage. Inspector Info shows **original → children** via lineage query (**#154 MERGED**). See [`M7_AUTO_SLICE_DERIVED_EXPORT.md`](./M7_AUTO_SLICE_DERIVED_EXPORT.md). |
| Stem separation | Multiple outputs from one source via `STEM` + `StemRole` parameters |
| Node recording | `NODE_RECORDING_PROCESS` / `IMPORT_PROCESS` kinds without PerformanceSession in core |

## Schema

- Migration **12:** `asset_derivations` (#147).
- Migration **13:** `file_instances.storage_scope` adds `mac_derived`.

## M7-06 status

**IMPLEMENTED_NOT_FULLY_ACCEPTED** as of `main` #154 (`37f86c9`). Historical slice notes below are **implementation inventory**, not Native PASS.

- Lineage registration and persistence (#147).
- TRIM derived WAV pipeline (#148–#151).
- Slice export (1 slice) backend + UI (#152–#153).
- Lineage query IPC + Inspector Info (#154): parent get + children list; mac_derived not injected into Library browse.

Native checklists remain **NOT_RUN**. Stem/normalize/resample, Library browse projection, and batch remain **post-M7** per [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md).

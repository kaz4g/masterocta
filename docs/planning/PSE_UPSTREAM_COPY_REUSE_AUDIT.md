# Upstream copy implementation reuse audit

Work ID: `MO-PSE-UPSTREAM-PATTERN-COPY-READONLY-1`  
Upstream repository: `davidferlay/octatrack-manager`  
Upstream comparison SHA: `f2c0d211a5fb0af104a8ba308b857baf478e09f2`  
MasterOCTa comparison SHA: `28f0fac93d2a93071a2cdb91491ffc3a4d26c7f5` (`origin/main` at audit time)

This document compares legacy copy helpers retained in MasterOCTa against upstream at the
pinned SHA. Upstream unit or integration test success is **not** treated as MasterOCTa device
safety evidence.

## Judgment keys (this work)

```text
UPSTREAM_COPY_AUDIT = COMPLETE
PATTERN_COPY_PURE_TRANSFORM = IMPLEMENTED (read-only preview path)
PATTERN_COPY_PREVIEW = PASS (scoped; see limits below)
SOURCE_IMMUTABILITY = PASS (in-memory tests)
NO_WRITE_PATH = PASS (no Apply; legacy IPC unchanged)
BANK_APPLY_AUTHORIZED = NO
PATTERN_APPLY_AUTHORIZED = NO
LEGACY_WRITE_GATE = UNCHANGED
```

## Function comparison summary

| Function | Location (both trees) | Upstream vs MasterOCTa body | Reuse for preview |
| --- | --- | --- | --- |
| `copy_bank` | `src-tauri/src/project_reader.rs` | Large diff (MasterOCTa slimmer); core slot remap + `to_data_file` same idea | **BLOCKED** — writes `bankNN.work`, sample remap |
| `copy_patterns` | same | Substantially same in-memory pattern loop; upstream adds more integration tests | **Pure loop only** — clone pattern, mode_scope, part_assignment |
| `copy_parts` | same | Same part unsaved/saved/name copy + write | **BLOCKED** — writes bank |
| `copy_tracks` | same | Part params + pattern trigs + write | **BLOCKED** — writes bank |
| `copy_sample_slots` | same | Project + pool I/O + write | **BLOCKED** |
| `build_remap_table` | same | Same algorithm (dedup, keep position, first free) | **BLOCKED** for pattern preview — Bank copy only |
| `remap_bank_slot_references` | same | Mutates bank pattern/part slot bytes | **BLOCKED** — mutation |
| `pairSourcesWithDests` | upstream `src/utils/multiSelect.ts` only | **Absent** on MasterOCTa `main` | **BLOCKED** as safe ordering — not ported |
| `orderCopyPairs` | upstream `src/utils/multiSelect.ts` only | **Absent** on MasterOCTa `main` | **BLOCKED** — greedy ordering; cycles fall through |

Evidence class for table rows: **CODE_CONFIRMED** (both SHAs inspected via git).

## `copy_patterns` — inputs, outputs, files

**Inputs:** absolute project paths, bank indices, source/dest pattern index vectors, part
assignment mode string, optional dest part, track mode, optional track indices, mode scope.

**Reads:** source bank `bankNN.work` if present else `bankNN.strd`. Destination bank prefers
`bankNN.work`, else reads `bankNN.strd` into memory but **writes only** `bankNN.work`.

**Pattern/Part scope:** overwrites destination pattern slot(s); adjusts `part_assignment` only
(no Part body copy). Track scope: all / audio-only / midi-only / specific indices.

**Same vs cross bank:** single destination bank per call; cross-project allowed by API.

**Overwrite:** destination pattern bytes replaced (partially when track mode is specific).

**Invalid input:** index range errors; count mismatch for multi pattern; missing banks.

**MasterOCTa delta:** Tauri IPC wrapped with `deny_legacy_write!()` (`legacy_command_gate.rs`);
function body still present for reference.

Classification: **CODE_CONFIRMED**. Device safety: **BLOCKED** (legacy write disabled; no
Apply).

## `copy_source_part` vs documentation

User guide [`user-guide/docs/features/copy-patterns.md`](../../user-guide/docs/features/copy-patterns.md)
states “Copy Source Part” copies part data. Implementation sets
`dest_pattern.part_assignment = source_pattern.part_assignment` only.

Classification: **CODE_CONFIRMED** (mismatch). Part body copy: **BLOCKED** in preview.

## Working / SavedCheckpoint

Legacy read: `.work` preferred, else `.strd`. Legacy write: destination `bankNN.work` only.

MasterOCTa read model keeps Working and SavedCheckpoint as separate `BankStructure` entries
(`project_structure.rs`). No substitution.

Classification: **DEVICE_EVIDENCE_REQUIRED** for copy/paste role rules (`#217`, `PSE_BANK_STATE_DOC_SEMANTICS_2.md`).
Preview requires explicit roles and **fail-closed** on cross-role copy.

## Sample lock and slot semantics

Legacy `collect_referenced_slots` and MasterOCTa `ot-domain` agree:

- Sample lock raw byte in pattern plocks (`flex_slot_id` field in ot-tools-io).
- `255` = no lock; `0` = slot 1 (0-based pool index).
- Static vs flex pool from **Part** machine type referenced by the pattern.

Recorder flex buffers (129–136): **CODE_CONFIRMED** in `track_slot_from_raw.rs`.

Pattern copy does **not** remap slot numbers. Bank copy uses `build_remap_table` (**separate**).

## Copy ordering (`orderCopyPairs`)

Upstream TypeScript only. Greedy “destination not a pending source” with drain-on-cycle fallback.
Not a proven swap/cycle-safe algorithm for all pairings.

Classification: **CODE_CONFIRMED** upstream; **BLOCKED** for MasterOCTa reuse without redesign.

## Tests and device evidence

Upstream `project_reader.rs` includes `copy_patterns_tests` and cross-function UTF-8 / pattern
mapping tests (removed or reduced on MasterOCTa `main`). Those tests exercised **write** paths.

MasterOCTa PSE device evidence:

- Cross-bank **Pattern Paste** on device (`PSE_PATTERN_PASTE_PERSISTENCE.md`) — **DEVICE_CONFIRMED** for paste persistence semantics only, not legacy `copy_patterns`.
- Bank Copy state doc matrix — **STOP_WITH_FINDINGS** / **BLOCKED** for promotion.

Upstream test pass: **UNIT_TEST_CONFIRMED** upstream only — **BLOCKED** as MasterOCTa safety proof.

## Reuse allowed (read-only preview)

1. In-memory pattern clone loop from `copy_patterns` (all / audio / midi / specific tracks).
2. Part assignment modes `keep_original`, `copy_source_part` (assignment integer only),
   `select_specific`.
3. Domain slot / sample-lock classification (`sample_lock_reference`, `track_slot_from_raw`).

## Reuse forbidden (unchanged this work)

- `to_data_file`, checksum rewrite, filesystem writes.
- Legacy Tauri `copy_*` command enablement.
- `build_remap_table` / `remap_bank_slot_references` for pattern-only preview.
- Treating `orderCopyPairs` as safe without proof.

## Open items / next device work

| Topic | Classification |
| --- | --- |
| Copy Working → SavedCheckpoint semantics | **UNKNOWN** / **DEVICE_EVIDENCE_REQUIRED** |
| Pattern copy vs Pattern Paste byte identity | **UNKNOWN** |
| Cross-bank pattern copy without device paste | **UNKNOWN** |
| Scene / Arranger / Recorder impact of pattern overwrite | **UNMODELED** in read model |

## Next work IDs (not in this PR)

1. **MO-PSE-PATTERN-COPY-PREVIEW-UI-1** — Project Structure Viewer, read-only diff display.
2. **MO-PSE-BANK-COPY-PREVIEW-REMAP-1** — Read-only Bank Copy slot remap preview aligned with `BankChangePlan` observations ([`PSE_BANK_COPY_REMAP_PREVIEW.md`](./PSE_BANK_COPY_REMAP_PREVIEW.md); legacy `build_remap_table` remains Apply-blocked).
3. **MO-PSE-MOVE-SWAP-SPEC-1** — Move/Swap semantics independent of copy+clear.

## Safety gates (unchanged)

```text
LEGACY_COPY_BANK = DISABLED
LEGACY_COPY_PATTERNS = DISABLED
BANK_CHANGEPLAN_READINESS = NOT_READY
APPLY_AUTHORIZED = NO
BANK_MUTATION_GATES = BLOCKED
BANK_RECOVERY_GATES = BLOCKED
ISSUE_181 = OPEN
ISSUE_217 = OPEN
ISSUE_221 = OPEN
```

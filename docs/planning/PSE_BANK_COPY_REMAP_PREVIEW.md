# Bank Copy sample-slot remap preview

Work ID: `MO-PSE-BANK-COPY-PREVIEW-REMAP-1`  
Related issues: [#181](https://github.com/kaz4g/masterocta/issues/181), [#217](https://github.com/kaz4g/masterocta/issues/217), [#221](https://github.com/kaz4g/masterocta/issues/221)  
Upstream comparison SHA: `f2c0d211a5fb0af104a8ba308b857baf478e09f2` (`davidferlay/octatrack-manager`)  
MasterOCTa baseline: `main` @ `b9699194cf2662276676f4456a6537b020a67705`

This work adds a **read-only**, **pure** preview model for how Bank Copy would affect
sample-slot references. It does **not** execute Bank Copy, remap bank bytes, copy
sample files, or authorize Apply.

## Judgment (this work)

```text
UPSTREAM_REMAP_AUDIT = COMPLETE
BANK_COPY_REMAP_ANALYSIS = PASS (scoped preview model)
STATIC_SLOT_CLASSIFICATION = PASS (unit + inventory)
FLEX_SLOT_CLASSIFICATION = PASS (unit + inventory)
SAMPLE_LOCK_CLASSIFICATION = PASS (via BankReferenceInventory observations)
SAME_PROJECT_REFERENCE_HANDLING = PASS
CROSS_PROJECT_HYPOTHETICAL_ANALYSIS = PASS (analysis only; copy unsupported)
BANK_CHANGEPLAN_ALIGNMENT = PASS (scoped observation parity test)
DETERMINISTIC_RESULT = PASS
SOURCE_IMMUTABILITY = PASS (fixture digest tests)
NO_WRITE_PATH = PASS (ot-plan pure module; no new IPC)
LEGACY_WRITE_GATE = UNCHANGED
BANK_APPLY_AUTHORIZED = NO
BANK_CHANGEPLAN_READINESS = NOT_READY
APPLY_AUTHORIZED = NO
```

Evidence class labels follow [`masterocta-format-evidence`](../../.agents/skills/masterocta-format-evidence/references/source-policy.md):
**CODE_CONFIRMED** vs **DEVICE_EVIDENCE_REQUIRED**.

## Upstream comparison

| Upstream helper | MasterOCTa legacy body | Reused in preview | Notes |
| --- | --- | --- | --- |
| `collect_referenced_slots` | Present in `project_reader.rs` | **No** (direct port) | Preview consumes `BankReferenceInventory` / scoped ChangePlan observations instead |
| `build_remap_table` | Present | **Partial algorithm only** | Same-position then lowest-free **per pool**; **no filename dedup** |
| `remap_bank_slot_references` | Present | **No** | Mutation; remains behind `deny_legacy_write!()` |
| `copy_bank` | Present | **No** | Writes bank + sample I/O |

### Sample lock field selection (CODE_CONFIRMED difference)

Upstream pattern scan always reads the sample-lock byte from `flex_slot_id` on
each plock. MasterOCTa uses [`locked_sample_slot_raw`](../../src-tauri/crates/ot-domain/src/sample_lock_reference.rs)
(machine-type-aware field) when building [`bank_reference_inventory.rs`](../../src-tauri/src/bank_reference_inventory.rs)
observations. The preview **does not** add a third interpreter; it classifies
references from ChangePlan-scoped observations only.

Device truth that either interpretation is universally correct on hardware:
**DEVICE_EVIDENCE_REQUIRED**.

## Reused rules

- Static and Flex pools are independent (1..=128 each).
- Raw `0` → slot 1; raw `255` / `Unassigned` → not a remap target.
- Recorder buffers (Flex 129–136) are not regular sample slots.
- Master track enabled → track 8 slot observations block the preview.
- Same input snapshot → deterministic output (`snapshot_identity` hash).
- Shared references to one source slot share one remap candidate.

## Rejected upstream behavior

- Filename-based destination dedup (`dest_by_filename`).
- Content-hash or path-based sample identity merge (see
  [`SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md`](./SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md)).
- `stack_from_first` placement mode.
- Any filesystem write, `to_data_file`, or legacy `copy_bank` execution.

## Same project vs cross project

| Case | Policy | Preview status | Apply |
| --- | --- | --- | --- |
| Same `RootId` + project path | `PreserveSlotNumbers` only | `SameProjectPreserved` | **NO** |
| Different project identity | `KeepThenLowestFree` (hypothetical) | `CrossProjectHypothetical` | **NO** (`cross_project_copy_supported()` always false) |

Same-project rules:

- Slot table is shared; preview never allocates new slots.
- Source and destination slot snapshots must match; mismatch → `SameProjectSnapshotMismatch` / blocked.
- Working document role only; SavedCheckpoint pairs → blocked (`CopySavedCheckpointSemanticsUnknown`).

Cross-project rules:

- Computes virtual remap candidates only.
- No write path to a real destination project.

## BankChangePlan boundary

- Preview input uses the same scoped observations as Copy planning:
  `ReferenceScopeRole::SourceContent` and `DestinationCurrent`.
- `plan_bank_change` schema, `PlanId`, and `ReadinessEvidence` are **unchanged**.
- Remap preview success does **not** upgrade `BANK_CHANGEPLAN_READINESS`.
- Alignment test: `scoped_observations()` output equals `BankChangePlan.reference_observations` for a synthetic Copy plan.

- Working document role is the only analyzed role. SavedCheckpoint **documents** stay in `scoped_observations()` for ChangePlan parity, and are excluded from remap classification. `PartStateRole::Saved` inside a Working bank document is kept.
- `unchanged_references` contains only `Unchanged` rows whose candidate equals the source slot. `remapped_references` contains `RemapCandidate` rows whose candidate differs.
- A `Resolved` observation must match an occupied `Resolved` source snapshot entry. Duplicate contradictory snapshot rows, unbound projects, and unproven destination occupancy block the preview. `snapshot_identity` hashes document health, coverage, both revisions, part state, audibility, and referenced path. It identifies the analysis input, not live media freshness.

`BANK_CHANGEPLAN_READINESS = NOT_READY` and `APPLY_AUTHORIZED = NO` stay unchanged.

## Unresolved dependencies (unchanged gates)

| Topic | Classification |
| --- | --- |
| Copy SavedCheckpoint semantics | **DEVICE_EVIDENCE_REQUIRED** (#217) |
| Bank internal identity on copy | **UNKNOWN** (#221) |
| Cross-project sample sameness | **DEVICE_EVIDENCE_REQUIRED** (no filename/hash merge in preview) |
| Bank Copy Apply / mutation | **BLOCKED** (#181, #191 ledger) |

## Implementation map

- Pure model: [`ot_plan::bank_copy_remap_preview`](../../src-tauri/crates/ot-plan/src/bank_copy_remap_preview.rs)
- Committed `s0_baseline_saved` proves byte identity around the preview. Its PATH-derived slot snapshot does **not** agree with Working `Resolved` bank observations, so that fixture run is `Blocked` / `SnapshotReferenceMismatch`. Same-project preservation is proven by the pure unit tests with a consistent snapshot, not by treating every non-empty `PATH` as `Resolved`.
- PSE inventory: [`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json) suites `ot-plan-bank-copy-remap-preview`, `masterocta-bank-copy-remap-preview`

## Tests run (local)

```bash
cargo test -p ot-plan bank_copy_remap_preview::
cargo test -p masterocta pse_bank_copy_remap_preview:: --features test-seams
node scripts/pse-read-model-check.mjs
pnpm run check:pse-bank-mutation
cargo fmt --all -- --check
```

Record exact PASS/FAIL in the PR body at merge time; do not treat skipped commands as PASS.

## Next minimal work

1. Optional read-only UI surfacing of remap preview (no Apply).
2. Device evidence for Bank Copy state-document roles (#217) before any Apply design.
3. Cross-project copy remains out of scope until identity and slot policy are proven.

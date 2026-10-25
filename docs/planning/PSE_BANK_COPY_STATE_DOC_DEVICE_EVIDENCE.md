# Native pattern copy/paste state-document device evidence

The Octatrack cannot copy a whole bank. The device operation under test is a
native **pattern copy/paste** from a pattern in Bank A to a pattern in Bank D.
Stage names and identifiers that still say `bank_copy` / `NATIVE_BANK_COPY` are
kept for compatibility with existing captures.

Work ID: `MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1`  
GitHub: [#217](https://github.com/kaz4g/masterocta/issues/217) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))  
Classification parent: [`PSE_BANK_STATE_DOC_SEMANTICS_2.md`](./PSE_BANK_STATE_DOC_SEMANTICS_2.md)

Base SHA: [`4eaf4ce9d3421786cd2c058bcb0333398522498a`](https://github.com/kaz4g/masterocta/commit/4eaf4ce9d3421786cd2c058bcb0333398522498a) (`main` after PR #235)


## Existing captures with missing or stale SHA256SUMS.json (diagnostic only)

The operator's current root has **S0: manifest missing**, **S1–S5:
manifest stale**. This is *independent* from the previously identified
S2→S3 mixed-session boundary. Do not issue `write-manifest` on that tree,
overwrite the original `capture.meta.json`, or silently reconstruct
missing `project.work` files.

Use the non-promoting **forensic inspection** mode on the original local
root (read-only, no manifest writes):

```bash
node scripts/pse-bank-copy-state-doc-device-evidence.mjs \
  inspect-mixed "$HOME/octa-captures/P_BANK_COPY_STATE" S3
```

- `inspection_report_generated=YES` means the command produced a report,
  **not** that device evidence passed. CLI exit 0 means only diagnostic success.
- `manifest_status=MISSING`: no manifest was present to authenticate bytes.
  `STALE_METADATA_ONLY`: recorded and current bytes differ only for
  `capture.meta.json`; this alone does not validate the operator account.
  `STALE_OTHER_OR_FILESET`: binary differences, missing files, a differing
  manifest header, or changes beyond metadata. Inspect
  `manifest_discrepancies` and `missing_files` stage by stage.
- `inspection_status=BYTES_READABLE` means all required stage files are
  regular and fit size caps; `PARTIAL_BYTES` means some are absent.
  `METADATA_ONLY` means none of the ten device documents are present, even
  though the metadata file exists. `device_files_readable` counts actual
  stage files (e.g. `0/60` across six stages).
  None of these labels claims semantic decodability (`bank_semantic_decode=NOT_RUN`).
- Byte comparisons within stored stage directories are
  `UNVERIFIED_STORED_BYTE_DIFF_ONLY`. They must not be presented as
  attributable device events. Cross-session S2→S3 remains
  `CROSS_SESSION_NOT_COMPARABLE`, with no claimed diff.
- `raw_snapshot_integrity=UNVERIFIED`, `device_evidence_promotion=BLOCKED`,
  `copy_effect_attribution=INCONCLUSIVE` and
  `working_content_transfer=NOT_PROVEN_BY_THIS_INSPECTION` remain explicit.

If all stages are `METADATA_ONLY`, check whether the original binary documents
are located elsewhere, without modifying the capture tree:

```bash
find "$HOME/octa-captures" -maxdepth 10 -type f \
  \( -name 'project.work' -o -name 'bank01.work' -o -name 'bank04.work' \) -print
```

A missing file is not a hash mismatch; there are no current bytes to compare.
Do not copy an arbitrary candidate into the capture directory: first confirm
its SHA-256 matches the recorded manifest and stage provenance. Preserve the
original and reconstruct, if possible, in a separate versioned working copy.


If the report says `project.work` is missing, find the actual original
stage path before building any **separate** versioned working copy. Do not
synthesize a project file or rewrite the only surviving hashes to make
a verdict green. Pattern Paste working-content behavior established in
other captures must not be silently generalized to a full Bank Copy rule.

## Mixed-session recovery (read-only raw audit)

The 2026-10-19 operator root contains S0–S2 from an earlier recording and
recaptured S3–S5 without a proven continuation from S2. It must not be
represented as one continuous six-stage device session.

The harness now offers an **independent raw-snapshot audit** for these existing
bytes. For the operator's known boundary before S3:

```bash
CAPTURE_ROOT="$HOME/octa-captures/P_BANK_COPY_STATE"
node scripts/pse-bank-copy-state-doc-device-evidence.mjs audit-mixed "$CAPTURE_ROOT" S3
```

The final `S3` is a read-only operator declaration that S3 starts another
recording. If stages have different non-empty `capture_run_id` values, the
audit also detects the boundary automatically. Blank run IDs **do not**
establish continuity. No `capture.meta.json`, device binary or
`SHA256SUMS.json` is changed.

- `raw_snapshot_integrity = PASS` means all six **individual** snapshots
  match their manifests, provenance envelope, pinned OS and bank decode.
  It does **not** mean that the sequence or paste provenance is proven.
- Each stage reports `ui_consistency` separately; legacy S2–S5 labels like
  `A01` on Banks D and B are reported `MISMATCH`, never silently corrected.
- `session_partitions` split the recorded stages. The S2→S3 transition is
  `CROSS_SESSION_NOT_COMPARABLE`; its `changed_files` is null, not an
  invented device-operation difference.
- The audit reports S1 `.work` versus `.strd` divergence and raw S1→S2
  destination file changes. Whole-Bank hashes **cannot** establish which
  source Pattern content was pasted.
- `working_content_transfer = NOT_PROVEN_BY_THIS_AUDIT`,
  `device_evidence_promotion = BLOCKED` and Bank Apply stays forbidden.
  The operator's observation that a Pattern Paste transfers unsaved working
  content is not contradicted, but cannot become a formal state-document
  rule from this mixed recording.

Run the strict `analyze` command separately for canonical gating. The
existing S2–S5 metadata, unexplained S0→S1 destination change, missing
non-mutating transport control and missing UI sentinels still prevent
formal promotion. A valid future complete capture must satisfy those gates.

## Judgment (Phase B — operator capture revalidated)

Operator-local bytes: `~/octa-captures/P_BANK_COPY_STATE/` (not committed). S3/S4/S5
were recaptured after a control-bank correction (2026-10-19). That redo has no run
id proving it continued from the stored S2 tree.

```text
DISPOSABLE_PROJECT = P_BANK_COPY_STATE
REPO_FIXTURE_ROOT = src-tauri/tests/fixtures/pse_bank_copy_state_doc/  (still empty receptacle)
OPERATOR_CAPTURE_ROOT = ~/octa-captures/P_BANK_COPY_STATE/

DEVICE_CAPTURE = REJECTED
DEVICE_EVIDENCE_PROMOTION = BLOCKED
RESULT = STOP_WITH_FINDINGS
PATTERN_UI_QUALIFICATION = FAIL
PRE_SOURCE_WORK_STRD_DIVERGENCE = PASS
SOURCE_ONLY_PRECONDITION = CONTAMINATED
CAPTURE_TRANSPORT_CONFIDENCE = UNKNOWN
POWER_CYCLE_CONTROL = MISSING
IMMEDIATE_COPY_TIMING_ATTRIBUTION = INCONCLUSIVE
POST_COPY_SESSION_CONTINUITY = NOT_PROVEN
CONTROL_SWITCH_ATTRIBUTION = INCONCLUSIVE
PROJECT_SAVE_ATTRIBUTION = INCONCLUSIVE
PROJECT_RELOAD_ATTRIBUTION = INCONCLUSIVE
DESTINATION_UI_SENTINEL = NOT_RECORDED
COPY_EFFECT_ATTRIBUTION = INCONCLUSIVE

COPY_STATE_DOC_RULE = BLOCKED
MOVE_STATE_DOC_RULE = BLOCKED
SWAP_STATE_DOC_RULE = BLOCKED
COPY_SAVED_CHECKPOINT_SEMANTICS = UNKNOWN

READINESS_GAP_WORKING_SAVEDCHECKPOINT = OPEN
ISSUE_217_CLOSE_READY = NO
ISSUE_221 = OPEN
APPLY_AUTHORIZED = NO
MASTER_OCTA_FILESYSTEM_WRITE = NO
```

Full hash-level directory diffs:
[`PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE_PHASE_B_MATRIX.md`](./PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE_PHASE_B_MATRIX.md).

S2–S5 fail closed because operator `current_pattern_ui` is `A01` on Banks D and B.
Raw `[STATES]` are pattern **D01** at S2 and **B01** at S3–S5. Label correction alone
does not promote the run: the source-only step also changes `bank04.work`, the CF
copy has no flush exclusion, S3–S5 continuity is not proven, and no destination UI
sentinel is recorded. Domain rules stay **BLOCKED**. Repo fixture tree remains
without device bytes.

## Scope

Answer on disposable Octatrack MkII (`R0173` / `1.40`) only:

1. Native **pattern copy/paste A → D** — which destination roles change (`bank04.work`, `bank04.strd`)?
2. If `bank04.strd` changes — provenance vs source `.work`, source `.strd`, prior destination, or other?
3. Effect on `project.work` `[STATES] BANK` / `PATTERN`?
4. First attributable persistence transition: `NATIVE_BANK_COPY`, `CONTROL_SWITCH`, `PROJECT_SAVE`, `PROJECT_RELOAD`?

Not in scope: MasterOCTa Apply, Bank writer, #221 internal identity resolution.

## Bank roles (fixed)

| UI | File index | Role |
| --- | --- | --- |
| A | `bank01` | Source |
| B | `bank02` | Control (switch target) |
| C | `bank03` | Untouched negative control |
| D | `bank04` | Destination |

Do not reuse [`pse_bank_copy_persistence/`](../../src-tauri/tests/fixtures/pse_bank_copy_persistence/) (Pattern Paste, #227).

## Schemas

| Symbol | Value |
| --- | --- |
| `META_SCHEMA` | `masterocta.pse-bank-copy-state-doc-capture:v1` |
| `MANIFEST_SCHEMA` | `masterocta-pse-bank-copy-state-doc-manifest:v1` |
| `OPERATION_KIND` | `pattern_copy_paste` (legacy `NATIVE_BANK_COPY` still accepted) |

## Stages

| Stage | Directory | Semantics | Prior transition |
| --- | --- | --- | --- |
| S0 | `s0_baseline_saved` | `BASELINE_SAVED` | — |
| S1 | `s1_source_working_diverged_pre_copy` | `SOURCE_WORKING_DIVERGED_PRE_COPY` | `SOURCE_WORKING_ONLY_EDIT` |
| S2 | `s2_immediately_after_bank_copy` | `IMMEDIATE_NATIVE_BANK_COPY` | `NATIVE_BANK_COPY` |
| S3 | `s3_after_control_switch` | `CONTROL_SWITCH` | `CONTROL_SWITCH` |
| S4 | `s4_after_project_save` | `PROJECT_SAVE` | `PROJECT_SAVE` |
| S5 | `s5_after_project_reload` | `PROJECT_RELOAD` | `PROJECT_RELOAD` |

### S1 hard gate

After working-only edit on Bank A (no Project Save), **`bank01.work` MUST NOT equal `bank01.strd`** on the acquisition path. If equal: **STOP** — do not perform the pattern copy/paste; record `PRE_SOURCE_ROLE_DIVERGENCE = NOT_PROVEN`.

`project.work` may also differ between S0 and S1, but **only** in the
current-position lines inside `[STATES]` (`BANK=<n>` and `PATTERN=<n>`). Every
other line must be byte-identical, including line endings. Any other
`project.work` change, and any change to `project.strd` or to a bank file other
than `bank01.work`, keeps `SOURCE_ONLY_PRECONDITION = CONTAMINATED`. The harness
reports the comparison as `SOURCE_ONLY_PROJECT_WORK_CHANGE`
(`UNCHANGED`, `POSITION_ONLY`, or `OTHER`).

### Optional copy/paste metadata

| Field | Values |
| --- | --- |
| `operation_kind` | Optional. `pattern_copy_paste`; legacy `NATIVE_BANK_COPY` is still accepted. Any other value is rejected. |
| `source_pattern` | Optional. Bank-qualified pattern label on the source bank (for example `A04`). |
| `destination_pattern` | Optional. Bank-qualified pattern label on the destination bank (for example `D01`). |

Empty pattern fields mean "not recorded". The S2 values are reported as
`COPY_SOURCE_PATTERN` / `COPY_DESTINATION_PATTERN`.

### Destination write timing

On-device observation: pattern copy/paste transfers the source pattern's unsaved
working content. The pasted destination pattern in the destination `.work`
matches the source pattern from the source `.work` (including an unsaved edit)
and differs from the source `.strd`. Only the pasted pattern changes in the
destination `.work`; `.strd` files stay unchanged until project save.

The destination `.work` may be written either immediately (S2) or only when the
device switches away from the pasted bank (S3). Both are expected. The harness
reports `DEST_WORK_WRITE_TIMING`:

| Value | Meaning |
| --- | --- |
| `ON_PASTE` | Destination `.work` changed between S1 and S2. |
| `DEFERRED_TO_BANK_SWITCH` | Unchanged at S2, changed at S3 (written on bank switch). Expected; not an error. |
| `NOT_WRITTEN_BY_BANK_SWITCH` | Unchanged at both S2 and S3. |

Destination `.work` provenance is classified from the stage where it was written
(S2 or S3). The comparison is whole-file, so a single-pattern paste usually
reports `DERIVED_OTHER`; pattern-level comparison is not part of this harness.

### Transport

Every stage records `capture_transport`, `capture_required_mode_change`, and `capture_may_flush_device_state` (non-empty, not `unknown`). If acquisition may flush device state, retain bytes but classify `IMMEDIATE_COPY_TIMING_ATTRIBUTION = INCONCLUSIVE` and do not promote Copy timing rules.

`capture_may_flush_device_state = no` is accepted only with a **power-cycle control**:

1. `capture_flush_exclusion` starts with the kind `power_cycle_control` (for example `power_cycle_control: S0 recapture after power cycle matched`).
2. `<root>/control_s0_power_cycle/` exists and contains `project.work`, `project.strd`, and `bank01..04.work/strd` (10 files).
3. Its `SHA256SUMS.json` verifies (`verify-manifest control_s0_power_cycle`).
4. All 10 file hashes are byte-identical to `s0_baseline_saved`.

Otherwise `no` is incomplete metadata: `CAPTURE_TRANSPORT_CONFIDENCE = UNKNOWN`. A free-text exclusion without the `power_cycle_control` kind does not pass. The harness reports `POWER_CYCLE_CONTROL` as `VERIFIED`, `MISSING`, `MANIFEST_INVALID`, `MISMATCH`, or `REJECTED`.

The control capture is taken **right after S0** (runbook step E2). The operator powers off the Octatrack, removes the CF card, copies the files into `control_s0_power_cycle/`, reinserts the card, and powers on. No other actions happen in between. The control proves that this acquisition path leaves S0 unchanged. It does not prove that later stages are free of flushes caused by other actions.

Do **not** assume USB disk mode, CF removal, power-off, or Mac mount is non-mutating without this control.

## Harness

```bash
node scripts/pse-bank-copy-state-doc-device-evidence.mjs status
node scripts/pse-bank-copy-state-doc-device-evidence.mjs analyze
node scripts/pse-bank-copy-state-doc-device-evidence.mjs write-manifest <stage>
node scripts/pse-bank-copy-state-doc-device-evidence.mjs verify-manifest <stage>
node scripts/pse-bank-copy-state-doc-device-evidence.mjs write-manifest control_s0_power_cycle
node scripts/pse-bank-copy-state-doc-device-evidence.mjs verify-manifest control_s0_power_cycle
node scripts/pse-bank-copy-state-doc-device-evidence.mjs dataset
```

The commands above use the empty repository fixture. Pass the operator root as the next argument, or set `CAPTURE_ROOT`. For `write-manifest` and `verify-manifest`, the root is the argument after the stage name. `CAPTURE_ROOT` is also used when that argument is omitted.

```bash
CAPTURE_ROOT="$HOME/octa-captures/P_BANK_COPY_STATE"
node scripts/pse-bank-copy-state-doc-device-evidence.mjs analyze "$CAPTURE_ROOT"
node scripts/pse-bank-copy-state-doc-device-evidence.mjs verify-manifest s2_immediately_after_bank_copy "$CAPTURE_ROOT"
```

`write-manifest` updates `SHA256SUMS.json` only.

## Operator runbook (ordered)

A. Prepare disposable project **P_BANK_COPY_STATE** on Octatrack MkII (`R0173` / `1.40`).  
B. Establish distinguishable sentinels on Bank **A** (source) and Bank **D** (destination). Record both on S0 and S1 as `source_ui_sentinel` and `prior_destination_ui_sentinel`. The two values must differ.
C. Select source Bank **A** and a **non-zero** Pattern (preferred UI **A04**, raw `PATTERN=3` — record actual UI + raw). Pattern UI is bank-qualified (`A04`, `B01`, `D01`). An `A` prefix on Bank B or D is rejected.
D. Explicit **Project Save** (baseline).  
E. Capture **S0** (+ `save_operation` text).  
E2. **Power-cycle control, immediately after S0.** Power off the Octatrack, remove the CF card, copy the 10 project/bank files into `control_s0_power_cycle/`, reinsert the card, and power on. Do nothing else. Run `write-manifest control_s0_power_cycle`. If any hash differs from S0, **STOP**: the transport is not proven non-mutating.  
F. Working-only edit on Bank **A** — **no Project Save** (+ `working_edit_operation`).  
G. Capture **S1**.  
H. Verify on acquisition path: **`bank01.work` ≠ `bank01.strd`**.  
I. If equality persists: **STOP** (do not copy).  
J. Native **pattern copy/paste** from a Bank **A** pattern to a Bank **D** pattern (+ exact `copy_operation` free text; optionally `source_pattern` / `destination_pattern`).  
K. Capture **S2** before control switch / Save / Reload.  
L. Switch to control Bank **B** (+ `control_switch_operation`).  
M. Capture **S3**.  
N. Explicit **Project Save** (+ `save_operation`).  
O. Capture **S4**.  
P. **Project Reload** (recommended) (+ `reload_operation`).  
Q. Capture **S5** (binaries before extra UI navigation where practical).  
R. Record `destination_ui_sentinel` on S2 and S5. Promotion requires both to equal `source_ui_sentinel`. The prior destination value, or a different S5 value, stays unpromoted.
S. Rebuild and verify all manifests; set `device_generated` / `capture_sequence_proven` only after operator confirmation.

## Phase B findings (summary)

| Question | Observation (this run) |
| --- | --- |
| Destination roles on copy/paste | Stored S1→S2 diffs show `bank04.work` and `bank04.strd` both differ. **COPY_EFFECT_ATTRIBUTION = INCONCLUSIVE** (contaminated S0→S1, unknown transport, sentinel not recorded). |
| Destination UI sentinel | **NOT_RECORDED** at S2 and S5. Hash changes alone do not show that the source sentinel was visible on Bank D or survived reload. |
| First persistence transition | Not attributed. The first stored hash difference vs S1 is the S2 directory; that is not a proven `NATIVE_BANK_COPY` persistence time. |
| Byte provenance vs source | **INCONCLUSIVE**. |
| `project.work` BANK/PATTERN | S0/S1 are Bank **A** / Pattern **A04**. Stored S2 is Bank **D** / Pattern **D01**. Stored S3–S5 are Bank **B** / Pattern **B01**. Operator meta still says `A01` for S2–S5 and is rejected. S2→S3 is not attributed to **CONTROL_SWITCH**. |
| Control bank `bank02` | S2→S3 directory diff shows no `bank02` hash change. **CONTROL_SWITCH_ATTRIBUTION = INCONCLUSIVE**. |
| Save / Reload | Stored S3→S4 and S4→S5 diffs are **INCONCLUSIVE** because those stages were recaptured without a run id continuing from this S2. |

Regenerate the harness judgment from the operator root:

```bash
CAPTURE_ROOT="$HOME/octa-captures/P_BANK_COPY_STATE"
node scripts/pse-bank-copy-state-doc-device-evidence.mjs analyze "$CAPTURE_ROOT"
```

Move/Swap rules stay **BLOCKED**; `ReadinessGap::WorkingSavedCheckpointRule` stays **OPEN**.

## Safety

```text
WRITE = NO (MasterOCTa)
DEVICE_CAPTURE = REJECTED
DEVICE_EVIDENCE_PROMOTION = BLOCKED
BANK_MUTATION_ENVELOPE = NO
APPLY = NO
```

## Salvage closure (2026-10-25)

This section is an addendum. The Phase B judgment above, the 2026-10-19 hash rows in [`PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE_PHASE_B_MATRIX.md`](./PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE_PHASE_B_MATRIX.md), and the Pattern Paste observation in [`PSE_PATTERN_PASTE_PERSISTENCE.md`](./PSE_PATTERN_PASTE_PERSISTENCE.md) are not rewritten.

Work ID: `MO-PSE-BANK-COPY-STATE-DOC-SALVAGE-STOP-1`.
Parent: [#217](https://github.com/kaz4g/masterocta/issues/217).
Diagnostic command: PR [#245](https://github.com/kaz4g/masterocta/pull/245), merge `ba8156eca748ef385db1cebcdc7e9ee7fd4d3dee`.

`inspect-mixed` was run read-only against the operator root `~/octa-captures/P_BANK_COPY_STATE` with the declared split `S3`. The capture tree was not modified: 442 non-`.DS_Store` entries kept the same mode, size, and mtime before and after the command.

The command is a report, not acceptance. It reported `inspection_report_generated=YES`, `stage_bytes_readable=0/6`, `device_files_readable=0/60`, `manifests_verified=0/6`, `raw_snapshot_integrity=UNVERIFIED`, `device_evidence_promotion=BLOCKED`, and `result=INSPECTION_REPORT_ONLY_NOT_EVIDENCE`.

- S0 `SHA256SUMS.json` is missing (`manifest_status=MISSING`).
- S1–S5 are `STALE_OTHER_OR_FILESET` and `METADATA_ONLY`. Each of the ten project/bank documents is `MISSING_CURRENT_FILE` at the stage root. The harness does not search child directories.
- The operator declaration splits S0–S2 from S3–S5 (`CROSS_SESSION_NOT_COMPARABLE` on S2→S3). `capture_run_id` is absent on all six `capture.meta.json` files, so the bytes do not prove one session. Phase B already records `POST_COPY_SESSION_CONTINUITY = NOT_PROVEN`. This closure treats the two groups as separate sessions. They are not one continuous experiment.
- The device bytes are nested at `<stage>/P_BANK_COPY_STATE3/`. They were not moved up to the stage root.

A separate read-only compare of those nested ten documents with the S1–S5 manifests did not rewrite any file:

- `bank02.work`, `bank02.strd`, `bank03.work`, and `bank03.strd` match the recorded digests. Nested `bank02.work` also equals the historical matrix digest `5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312`.
- `project.work`, `project.strd`, `bank01.work`, `bank01.strd`, `bank04.work`, and `bank04.strd` do not match. Nested `project.work` is 3054 bytes. The 2026-10-19 matrix records `project.work` at 3327 bytes. Those matrix rows stay as the historical directory diff.
- S0 has no manifest, so its nested bytes are unauthenticated.
- `bank02` and `bank03` are byte-identical to each other in the nested tree. That stored equality is not a Copy, Move, or Swap rule.

`src-tauri/tests/fixtures/pse_bank_copy_state_doc/` remains the empty receptacle (README only). No fixture was copied in to fill a missing stage file, and no mismatched hash was regenerated.

The Pattern Paste sequence on disposable `P_BANK_PERSIST` stays a recorded observation that unsaved working content can be transferred by Pattern Paste. That observation is not evidence for Bank Copy, Move, or Swap. `COPY_SAVED_CHECKPOINT_SEMANTICS` stays **UNKNOWN**.

The diagnostic note above, which mentions a separate working copy only when a candidate SHA-256 matches a recorded manifest, does not authorize repair of this capture. Salvage of `P_BANK_COPY_STATE` is closed. A new disposable capture, if any, is a separate task before any Bank write implementation.

The keys below are document audit items. They are not added to a runtime schema.

```text
DEVICE_CAPTURE = REJECTED
DEVICE_EVIDENCE_PROMOTION = BLOCKED
RAW_SNAPSHOT_INTEGRITY = UNVERIFIED
RESULT = STOP_WITH_FINDINGS

WORKING_CONTENT_TRANSFER_OBSERVATION = RECORDED
COPY_SAVED_CHECKPOINT_SEMANTICS = UNKNOWN

COPY_STATE_DOC_RULE = BLOCKED
MOVE_STATE_DOC_RULE = BLOCKED
SWAP_STATE_DOC_RULE = BLOCKED

ISSUE_217_CLOSE_READY = NO
BANK_CHANGEPLAN_READINESS = NOT_READY
APPLY_AUTHORIZED = NO
```

`#217` and `#181` stay **OPEN**. No Bank Apply path is authorized.
